"use client";

import { useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { Printer, ArrowLeft, Loader2, AlertCircle } from "lucide-react";
import { useRepair } from "@/lib/api/use-repairs";

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

export default function RepairIntakePrintPage() {
  const params = useParams();
  const router = useRouter();
  const id = typeof params.id === "string" ? params.id : "";
  const { data: ticket, isLoading, isError } = useRepair(id);
  const printedRef = useRef(false);

  useEffect(() => {
    if (ticket && !printedRef.current) {
      printedRef.current = true;
      const timer = setTimeout(() => {
        window.print();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [ticket]);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-white gap-2 text-sm text-[#666666]">
        <Loader2 className="h-5 w-5 animate-spin text-[#4a38f5]" />
        <span>Подготовка документа к печати...</span>
      </div>
    );
  }

  if (isError || !ticket) {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-white gap-3 p-4">
        <AlertCircle className="h-8 w-8 text-rose-500" />
        <p className="text-sm font-medium text-[#111111]">Наряд-заказ не найден</p>
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-[8px] border border-[#e5e5e5] px-3.5 py-1.5 text-xs text-[#111111] hover:bg-[#fafafa]"
        >
          Назад
        </button>
      </div>
    );
  }

  const dateStr = formatDate(ticket.receivedAt);

  return (
    <div className="min-h-screen bg-[#f5f5f5] p-4 sm:p-8 print:p-0 print:bg-white text-[#111111] font-sans">
      <style jsx global>{`
        @media print {
          @page {
            size: A4 portrait;
            margin: 8mm 10mm;
          }
          body {
            background: #ffffff !important;
            color: #000000 !important;
            padding: 0 !important;
          }
          .no-print {
            display: none !important;
          }
        }
      `}</style>

      {/* Floating control toolbar (hidden in print mode) */}
      <div className="no-print mx-auto max-w-3xl mb-4 flex items-center justify-between rounded-xl border border-[#e5e5e5] bg-white p-3 shadow-sm">
        <button
          type="button"
          onClick={() => router.back()}
          className="flex items-center gap-1.5 rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs font-medium text-[#111111] hover:bg-[#fafafa] transition-colors cursor-pointer"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Назад</span>
        </button>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-[#111111]">
            Акт приемки (Договор) №{ticket.ticketNumber}
          </span>
        </div>
        <button
          type="button"
          onClick={() => window.print()}
          className="flex items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-4 py-1.5 text-xs font-medium text-white shadow-xs hover:bg-[#3d2ee0] transition-colors cursor-pointer"
        >
          <Printer className="h-3.5 w-3.5" />
          <span>Распечатать</span>
        </button>
      </div>

      {/* A4 Printable Sheet */}
      <div
        className="mx-auto max-w-3xl rounded-[16px] border border-[#e5e5e5] bg-white p-8 md:p-10 shadow-xl print:shadow-none print:border-none print:p-0"
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
            Договор № {ticket.ticketNumber} от {dateStr}
          </h1>
          <div style={{ fontSize: "12px", color: "#333333", marginTop: "2px" }}>
            на оказание услуг по ремонту инструмента
          </div>
        </div>

        {/* Информация о заказе */}
        <div style={{ fontSize: "11px", lineHeight: "1.6", marginBottom: "12px" }}>
          <div>
            <strong>Заказчик:</strong> {ticket.customerName} {ticket.customerPhone}
            {ticket.companyName ? ` (${ticket.companyName})` : ""}
          </div>
          <div>
            <strong>Устройство:</strong> {ticket.equipment.type ? `${ticket.equipment.type} ` : ""}
            {ticket.equipment.brand} {ticket.equipment.model} S/N: {ticket.equipment.serialNumber || "—"}
          </div>
          <div>
            <strong>Неисправность:</strong> {ticket.defectDescription || "Не указана"}
          </div>
        </div>

        {/* Таблица: Комплектация | Неисправность */}
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
                {ticket.equipment.packageContents || "Обойма, 2 АКБ, Кейс"}
              </td>
              <td style={{ border: "1px solid #111111", padding: "6px 8px", verticalAlign: "top" }}>
                {ticket.defectDescription || "Не стреляет"}
              </td>
            </tr>
          </tbody>
        </table>

        {/* Пункты договора */}
        <div style={{ fontSize: "9.5px", lineHeight: "1.32", color: "#222222", textAlign: "justify", marginBottom: "14px" }}>
          <p style={{ margin: "0 0 4px 0" }}>
            ИП Сагайдак Антон Геннадьевич, именуемый в дальнейшем «Исполнитель» с одной стороны, и гражданин {ticket.customerName}{ticket.companyName ? ` (${ticket.companyName})` : ""}, именуемый в дальнейшем «Заказчик», с другой стороны, заключили настоящий договор о нижеследующем:
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
              Подписывая настоящий Договор, Заказчик соглашается на предоставление Исполнителю согласия на обработку его персональных данных.
            </li>
          </ol>
        </div>

        {/* Подписи верхнего блока */}
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", marginTop: "12px", marginBottom: "16px" }}>
          <div style={{ width: "45%" }}>
            <div><strong>Заказчик</strong> ____________________</div>
            <div style={{ fontSize: "10px", color: "#555555", marginTop: "2px" }}>
              {ticket.customerName} {ticket.customerPhone}
            </div>
          </div>
          <div style={{ width: "45%" }}>
            <div><strong>Исполнитель</strong> ____________________</div>
            <div style={{ fontSize: "10px", color: "#555555", marginTop: "2px" }}>
              {ticket.masterName || "ИП Сагайдак Антон Геннадьевич"}
            </div>
          </div>
        </div>

        {/* Линия отрыва */}
        <div style={{ borderTop: "1.5px dashed #444444", margin: "14px 0", position: "relative" }}>
          <span style={{ position: "absolute", top: "-8px", left: "16px", background: "#ffffff", padding: "0 6px", fontSize: "9px", color: "#888888" }}>
            линия отрыва
          </span>
        </div>

        {/* Нижний отрывной талон */}
        <div style={{ marginTop: "10px" }}>
          <div style={{ textAlign: "center", marginBottom: "10px" }}>
            <div style={{ fontWeight: 800, fontSize: "13px", textTransform: "uppercase" }}>
              Заказ-наряд на выполнение работ № {ticket.ticketNumber} от {dateStr}
            </div>
          </div>

          <div style={{ fontSize: "11px", lineHeight: "1.5", marginBottom: "10px" }}>
            <div>
              <strong>Заказчик:</strong> {ticket.customerName} {ticket.customerPhone}
              {ticket.companyName ? ` (${ticket.companyName})` : ""}
            </div>
            <div>
              <strong>Устройство:</strong> {ticket.equipment.type ? `${ticket.equipment.type} ` : ""}
              {ticket.equipment.brand} {ticket.equipment.model} S/N: {ticket.equipment.serialNumber || "—"}
            </div>
            <div>
              <strong>Неисправность:</strong> {ticket.defectDescription || "—"}
            </div>
          </div>

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
                  {ticket.equipment.packageContents || "Обойма, 2 АКБ, Кейс"}
                </td>
                <td style={{ border: "1px solid #111111", padding: "6px 8px", verticalAlign: "top" }}>
                  {ticket.defectDescription || "Не стреляет"}
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
                  {ticket.ticketNumber}
                </td>
              </tr>
            </tbody>
          </table>

          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", marginTop: "10px" }}>
            <div style={{ width: "45%" }}>
              <div><strong>Заказчик</strong> ____________________</div>
              <div style={{ fontSize: "10px", color: "#555555", marginTop: "2px" }}>
                {ticket.customerName} {ticket.customerPhone}
              </div>
            </div>
            <div style={{ width: "45%" }}>
              <div><strong>Исполнитель</strong> ____________________</div>
              <div style={{ fontSize: "10px", color: "#555555", marginTop: "2px" }}>
                {ticket.masterName || "ИП Сагайдак Антон Геннадьевич"}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
