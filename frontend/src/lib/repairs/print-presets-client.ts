import type { PrintLayoutConfig, PrintSectionType } from "@/lib/api/use-print-templates";

export interface PresetClientDefinition {
  slug: string;
  documentType: string;
  name: string;
  description: string;
  pageSize: "A4" | "A5" | "thermal_80mm";
  orientation: "portrait" | "landscape";
  layoutConfig: PrintLayoutConfig;
}

export const INTAKE_ACT_CLIENT_PRESET: PresetClientDefinition = {
  slug: "work_order",
  documentType: "work_order",
  name: "Акт приема-передачи оборудования",
  description: "Договор приема техники в ремонт с отрывным талоном мастера (экземпляр ИП Сагайдак А.Г.)",
  pageSize: "A4",
  orientation: "portrait",
  layoutConfig: {
    sectionsOrder: [
      "header",
      "customer",
      "equipment",
      "terms",
      "signatures",
      "tear_off_ticket",
    ],
    theme: {
      fontFamily: "Inter",
      fontSize: "medium",
      primaryColor: "#111111",
      margins: "compact",
      accentHeaders: true,
      showBorders: true,
    },
    header: {
      showLogo: true,
      logoUrl: "/service-logo.png",
      logoWidth: 120,
      showCompanyDetails: true,
      companyName: "Ремонт инструмента (Toua, Hybest, VAPP) ИП Сагайдак А.Г.",
      companyAddress: "Москва 3й проезд Марьиной рощи 40с1, 2 этаж, каб. 214",
      companyPhone: "+7 977 628 20 49",
      companyEmail: "",
      companyWebsite: "РЕМОНТ-ИНСТРУМЕНТ.РФ",
      companyInn: "",
      companyOgrn: "",
      workingHours: "Пн-Пт 10:00-19:00",
      documentTitle: "Договор",
      documentSubtitle: "на оказание услуг по ремонту инструмента",
      showDate: true,
      showDocNumber: true,
    },
    customer: {
      visible: true,
      title: "Заказчик",
      showName: true,
      showPhone: true,
      showEmail: false,
      showAddress: true,
      showPassport: false,
    },
    equipment: {
      visible: true,
      title: "Устройство",
      showTypeBrandModel: true,
      showSerial: true,
      showDefect: true,
      showAppearance: true,
      showPackage: true,
      showMaster: true,
      showEstimatedCost: false,
    },
    table: {
      visible: false,
      worksTitle: "Предварительный перечень услуг",
      partsTitle: "Запасные части",
      columns: [
        { id: "num", label: "№", visible: true, widthPercent: 6 },
        { id: "name", label: "Наименование", visible: true, widthPercent: 54 },
        { id: "qty", label: "Кол-во", visible: true, widthPercent: 12 },
        { id: "unit", label: "Ед.", visible: true, widthPercent: 8 },
        { id: "price", label: "Цена", visible: true, widthPercent: 10 },
        { id: "total", label: "Сумма", visible: true, widthPercent: 10 },
      ],
      showWorks: false,
      showParts: false,
      showVat: false,
      vatRate: 20,
      showDiscount: false,
      showTotals: false,
      showGrandTotalWords: false,
    },
    terms: {
      visible: true,
      title: "ПРЕДМЕТ ДОГОВОРА",
      termsText:
        "1. По настоящему договору Исполнитель обязуется принять, провести диагностику и при наличии технической возможности выполнить ремонт принятого устройства в указанный срок и за указанную стоимость. По факту выполнения ремонтных работ, Заказчик обязуется забрать устройство и оплатить результат выполненной работы.\n2. После проведения диагностики срок и стоимость ремонта могут быть изменены при обязательном устном согласовании с Заказчиком.\n3. Устройство с согласия Заказчика принято без разборки и без проверки внутренних повреждений. Заказчик согласен, что все неисправности и внутренние повреждения, которые могут быть обнаружены в устройстве при техническом обслуживании, возникли до приема устройства по данному договору.\n4. Исполнитель предупреждает Заказчика о возможном изменении проявления неисправности при проведении диагностики, если неисправность устройства вызвана попаданием жидкости или механическим повреждением.\n5. На выполненную работу и установленные запчасти Исполнитель предоставляет гарантию. Условия и срок гарантии зависят от устраненной неисправности и указаны в Акте выполненных работ.\n6. При утере договора получить аппарат Заказчик может при предъявлении паспорта.\n7. В случае неявки Заказчика за получением результата выполненной работы Исполнитель вправе, письменно предупредив Заказчика, по истечении двух месяцев со дня такого предупреждения продать результат работы за разумную цену, а вырученную сумму, за вычетом всех причитающихся Исполнителю платежей, внести в депозит в порядке, предусмотренном статьей 327 Гражданского кодекса Российской Федерации.\n8. Подписывая настоящий Договор, Заказчик соглашается на предоставление Исполнителю согласия на обработку его персональных данных. Персональные данные требуются исключительно для исполнения договора с Заказчиком.",
      showPdnConsent: false,
      pdnText: "",
      showWarrantyText: false,
      warrantyDays: 0,
    },
    signatures: {
      visible: true,
      showExecutor: true,
      executorTitle: "Исполнитель",
      showClient: true,
      clientTitle: "Заказчик",
      showStamp: false,
      stampText: "",
    },
    tearOffTicket: {
      visible: true,
      title: "Заказ-наряд на выполнение работ",
      showBarcodeOrQr: false,
      customNote: "",
    },
  },
};

export const REPAIR_ORDER_CLIENT_PRESET: PresetClientDefinition = {
  slug: "repair_order",
  documentType: "repair_order",
  name: "Заказ-наряд на ремонт",
  description: "Рабочий лист мастера с таблицей согласованных работ, материалов и расчетом стоимости",
  pageSize: "A4",
  orientation: "portrait",
  layoutConfig: {
    sectionsOrder: [
      "header",
      "customer",
      "equipment",
      "works_table",
      "parts_table",
      "totals",
      "terms",
      "signatures",
    ],
    theme: {
      fontFamily: "Inter",
      fontSize: "medium",
      primaryColor: "#111111",
      margins: "normal",
      accentHeaders: true,
      showBorders: true,
    },
    header: {
      showLogo: true,
      logoUrl: "",
      logoWidth: 130,
      showCompanyDetails: true,
      companyName: "",
      companyAddress: "",
      companyPhone: "",
      companyEmail: "",
      companyWebsite: "",
      companyInn: "",
      companyOgrn: "",
      workingHours: "",
      documentTitle: "ЗАКАЗ-НАРЯД НА РЕМОНТ",
      documentSubtitle: "Лист выполнения сервисных и восстановительных работ",
      showDate: true,
      showDocNumber: true,
    },
    customer: {
      visible: true,
      title: "Заказчик",
      showName: true,
      showPhone: true,
      showEmail: false,
      showAddress: false,
      showPassport: false,
    },
    equipment: {
      visible: true,
      title: "Данные оборудования",
      showTypeBrandModel: true,
      showSerial: true,
      showDefect: true,
      showAppearance: true,
      showPackage: false,
      showMaster: true,
      showEstimatedCost: true,
    },
    table: {
      visible: true,
      worksTitle: "Выполненные ремонтные работы",
      partsTitle: "Установленные запасные части и расходники",
      columns: [
        { id: "num", label: "№", visible: true, widthPercent: 5 },
        { id: "name", label: "Наименование", visible: true, widthPercent: 50 },
        { id: "qty", label: "Кол-во", visible: true, widthPercent: 12 },
        { id: "unit", label: "Ед.", visible: true, widthPercent: 8 },
        { id: "price", label: "Цена, ₽", visible: true, widthPercent: 12 },
        { id: "total", label: "Сумма, ₽", visible: true, widthPercent: 13 },
      ],
      showWorks: true,
      showParts: true,
      showVat: false,
      vatRate: 20,
      showDiscount: false,
      showTotals: true,
      showGrandTotalWords: true,
    },
    terms: {
      visible: true,
      title: "Порядок расчетов и выдачи",
      termsText:
        "Оплата выполненных работ производится Заказчиком в полном объеме в момент получения готового оборудования. Замененные дефектные детали возвращаются клиенту по первому требованию.",
      showPdnConsent: false,
      pdnText: "",
      showWarrantyText: true,
      warrantyDays: 30,
    },
    signatures: {
      visible: true,
      showExecutor: true,
      executorTitle: "Мастер / Исполнитель",
      showClient: true,
      clientTitle: "Заказчик",
      showStamp: true,
      stampText: "М.П.",
    },
    tearOffTicket: {
      visible: false,
      title: "Отрывной талон",
      showBarcodeOrQr: false,
      customNote: "",
    },
  },
};

export const COMPLETION_ACT_CLIENT_PRESET: PresetClientDefinition = {
  slug: "completion_act",
  documentType: "completion_act",
  name: "Акт выполненных работ с гарантией",
  description: "Итоговый финансово-отчетный акт с подробной сметой, гарантией качества и распиской",
  pageSize: "A4",
  orientation: "portrait",
  layoutConfig: {
    sectionsOrder: [
      "header",
      "customer",
      "equipment",
      "works_table",
      "parts_table",
      "totals",
      "terms",
      "signatures",
    ],
    theme: {
      fontFamily: "Inter",
      fontSize: "medium",
      primaryColor: "#111111",
      margins: "normal",
      accentHeaders: true,
      showBorders: true,
    },
    header: {
      showLogo: true,
      logoUrl: "",
      logoWidth: 130,
      showCompanyDetails: true,
      companyName: "",
      companyAddress: "",
      companyPhone: "",
      companyEmail: "",
      companyWebsite: "",
      companyInn: "",
      companyOgrn: "",
      workingHours: "",
      documentTitle: "АКТ ВЫПОЛНЕННЫХ РАБОТ",
      documentSubtitle: "Квитанция и гарантийный талон сервисного центра",
      showDate: true,
      showDocNumber: true,
    },
    customer: {
      visible: true,
      title: "Заказчик (Плательщик)",
      showName: true,
      showPhone: true,
      showEmail: false,
      showAddress: false,
      showPassport: false,
    },
    equipment: {
      visible: true,
      title: "Отремонтированное оборудование",
      showTypeBrandModel: true,
      showSerial: true,
      showDefect: true,
      showAppearance: false,
      showPackage: false,
      showMaster: true,
      showEstimatedCost: false,
    },
    table: {
      visible: true,
      worksTitle: "Выполненные работы и услуги",
      partsTitle: "Использованные детали и материалы",
      columns: [
        { id: "num", label: "№", visible: true, widthPercent: 5 },
        { id: "name", label: "Наименование", visible: true, widthPercent: 48 },
        { id: "qty", label: "Кол-во", visible: true, widthPercent: 12 },
        { id: "unit", label: "Ед.", visible: true, widthPercent: 8 },
        { id: "price", label: "Цена, ₽", visible: true, widthPercent: 13 },
        { id: "total", label: "Сумма, ₽", visible: true, widthPercent: 14 },
      ],
      showWorks: true,
      showParts: true,
      showVat: false,
      vatRate: 20,
      showDiscount: false,
      showTotals: true,
      showGrandTotalWords: true,
    },
    terms: {
      visible: true,
      title: "Гарантийные обязательства и приемка",
      termsText:
        "1. Гарантийный срок на выполненные работы и установленные оригинальные запасные части составляет 30 календарных дней со дня выдачи изделия.\n2. Гарантия не распространяется при наличии следов попадания влаги, механических повреждений, нарушения пломб или неквалифицированного вмешательства.\n3. Работы выполнены в полном объеме, в установленный срок и с надлежащим качеством. Оборудование проверено и протестировано в присутствии Заказчика. Претензий по качеству и комплектности не имею.",
      showPdnConsent: false,
      pdnText: "",
      showWarrantyText: true,
      warrantyDays: 30,
    },
    signatures: {
      visible: true,
      showExecutor: true,
      executorTitle: "Исполнитель / Мастер",
      showClient: true,
      clientTitle: "Заказчик (работу принял, претензий не имею)",
      showStamp: true,
      stampText: "М.П.",
    },
    tearOffTicket: {
      visible: false,
      title: "Отрывной талон",
      showBarcodeOrQr: false,
      customNote: "",
    },
  },
};

export const RECEIPT_CLIENT_PRESET: PresetClientDefinition = {
  slug: "receipt",
  documentType: "receipt",
  name: "Товарный чек / Квитанция",
  description: "Компактная квитанция об оплате услуг и запасных частей для бухгалтерии и клиента",
  pageSize: "A4",
  orientation: "portrait",
  layoutConfig: {
    sectionsOrder: [
      "header",
      "customer",
      "equipment",
      "works_table",
      "parts_table",
      "totals",
      "signatures",
    ],
    theme: {
      fontFamily: "Inter",
      fontSize: "medium",
      primaryColor: "#111111",
      margins: "compact",
      accentHeaders: true,
      showBorders: true,
    },
    header: {
      showLogo: true,
      logoUrl: "",
      logoWidth: 120,
      showCompanyDetails: true,
      companyName: "",
      companyAddress: "",
      companyPhone: "",
      companyEmail: "",
      companyWebsite: "",
      companyInn: "",
      companyOgrn: "",
      workingHours: "",
      documentTitle: "ТОВАРНЫЙ ЧЕК / КВИТАНЦИЯ",
      documentSubtitle: "Подтверждение оплаты сервисных услуг и материалов",
      showDate: true,
      showDocNumber: true,
    },
    customer: {
      visible: true,
      title: "Покупатель / Заказчик",
      showName: true,
      showPhone: true,
      showEmail: false,
      showAddress: false,
      showPassport: false,
    },
    equipment: {
      visible: true,
      title: "Объект ремонта",
      showTypeBrandModel: true,
      showSerial: true,
      showDefect: false,
      showAppearance: false,
      showPackage: false,
      showMaster: false,
      showEstimatedCost: false,
    },
    table: {
      visible: true,
      worksTitle: "Оказанные услуги",
      partsTitle: "Приобретенные товары / запчасти",
      columns: [
        { id: "num", label: "№", visible: true, widthPercent: 6 },
        { id: "name", label: "Наименование", visible: true, widthPercent: 48 },
        { id: "qty", label: "Кол-во", visible: true, widthPercent: 12 },
        { id: "unit", label: "Ед.", visible: true, widthPercent: 8 },
        { id: "price", label: "Цена", visible: true, widthPercent: 13 },
        { id: "total", label: "Сумма", visible: true, widthPercent: 13 },
      ],
      showWorks: true,
      showParts: true,
      showVat: false,
      vatRate: 20,
      showDiscount: false,
      showTotals: true,
      showGrandTotalWords: true,
    },
    terms: {
      visible: false,
      title: "Условия",
      termsText: "",
      showPdnConsent: false,
      pdnText: "",
      showWarrantyText: false,
      warrantyDays: 30,
    },
    signatures: {
      visible: true,
      showExecutor: true,
      executorTitle: "Продавец / Кассир",
      showClient: true,
      clientTitle: "Покупатель",
      showStamp: true,
      stampText: "М.П.",
    },
    tearOffTicket: {
      visible: false,
      title: "Талон",
      showBarcodeOrQr: false,
      customNote: "",
    },
  },
};

export const ALL_CLIENT_PRESETS: PresetClientDefinition[] = [
  INTAKE_ACT_CLIENT_PRESET,
  COMPLETION_ACT_CLIENT_PRESET,
  RECEIPT_CLIENT_PRESET,
];

export function getPresetByDocumentType(type: string): PresetClientDefinition {
  const found = ALL_CLIENT_PRESETS.find(
    (p) => p.documentType === type || p.slug === type,
  );
  return found ?? INTAKE_ACT_CLIENT_PRESET;
}

// ---------------------------------------------------------------------------
// Realistic Preview Sample Data
// ---------------------------------------------------------------------------

export interface PreviewSampleData {
  orderNumber: string;
  orderDate: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  customerAddress: string;
  customerPassport: string;
  companyName?: string;
  companyInn?: string;
  equipmentType: string;
  equipmentBrand: string;
  equipmentModel: string;
  equipmentSerial: string;
  malfunctions?: string[];
  defectDescription: string;
  additionalDefectDescription?: string;
  appearance: string;
  packageContents: string;
  masterName: string;
  estimatedCost: number;
  toolInfo?: string;
  clientInfo?: string;
  notes?: string;
  comments?: string;
  works: Array<{
    id: string;
    name: string;
    qty: number;
    unit: string;
    price: number;
    total: number;
  }>;
  parts: Array<{
    id: string;
    name: string;
    qty: number;
    unit: string;
    price: number;
    total: number;
  }>;
}

export const DEFAULT_PREVIEW_SAMPLE_DATA: PreviewSampleData = {
  orderNumber: "№ 269",
  orderDate: "27.10.2026",
  customerName: "Тагир (ref: Leha)",
  customerPhone: "+7 928 949-45-43",
  customerEmail: "",
  customerAddress: "ООО \"Мега-Строй\"",
  customerPassport: "",
  companyName: "ООО \"Мега-Строй\"",
  companyInn: "2367016930",
  equipmentType: "Монтажный пистолет",
  equipmentBrand: "Toua",
  equipmentModel: "GSN50",
  equipmentSerial: "7w1231266557",
  malfunctions: ["Профилактика"],
  defectDescription: "Профилактика",
  additionalDefectDescription: "Периодически клинит боёк при интенсивной стрельбе",
  appearance: "",
  packageContents: "Обойма",
  masterName: "ИП Сагайдак Антон Геннадьевич",
  estimatedCost: 0,
  toolInfo: "Монтажный пистолет Toua GSN50 S/N: 7w1231266557",
  clientInfo: "ООО \"Мега-Строй\" (ИНН: 2367016930), Представитель: Тагир (ref: Leha), тел. +7 928 949-45-43",
  notes: "Срочный заказ, проверить поршневую группу и резиновые уплотнители",
  comments: "Срочный заказ, проверить поршневую группу и резиновые уплотнители",
  works: [
    {
      id: "w1",
      name: "Комплексная диагностика и профилактика инструмента",
      qty: 1,
      unit: "усл.",
      price: 1500,
      total: 1500,
    },
  ],
  parts: [],
};

/**
 * Преобразует реальные поля заказ-наряда (RepairOrderDTO / RepairTicket)
 * в структуру PreviewSampleData для конструктора и превью бланков.
 */
export function mapRepairToPreviewSampleData(
  order: any,
): PreviewSampleData {
  if (!order) return DEFAULT_PREVIEW_SAMPLE_DATA;

  const rawNumber = String(order.ticketNumber || order.ticket_number || "");
  const orderNumber = rawNumber
    ? rawNumber.startsWith("№")
      ? rawNumber
      : `№${rawNumber}`
    : DEFAULT_PREVIEW_SAMPLE_DATA.orderNumber;

  const rawDate =
    order.receivedAt || order.received_at || order.createdAt || order.created_at;
  let orderDate = DEFAULT_PREVIEW_SAMPLE_DATA.orderDate;
  if (rawDate) {
    try {
      const d = new Date(rawDate);
      if (!isNaN(d.getTime())) {
        orderDate = d.toLocaleDateString("ru-RU");
      }
    } catch {
      // ignore
    }
  }

  const companyName =
    order.companyName ||
    order.company_name ||
    order.company?.name ||
    order.deal?.companyName ||
    "";

  const companyInn =
    order.companyInn ||
    order.company_inn ||
    order.company?.inn ||
    "";

  const customerName =
    order.customerName ||
    order.customer_name ||
    order.customer?.name ||
    DEFAULT_PREVIEW_SAMPLE_DATA.customerName;

  const customerPhone =
    order.customerPhone ||
    order.customer_phone ||
    order.customer?.phone ||
    "";

  const customerEmail =
    order.customerEmail ||
    order.customer_email ||
    order.customer?.email ||
    "";

  const customerAddress =
    order.customerAddress ||
    order.customer_address ||
    order.companyLegalAddress ||
    order.legalAddress ||
    order.company?.legalAddress ||
    "";

  const customerPassport =
    order.customerPassport ||
    order.customer_passport ||
    "";

  const eq = order.equipment || {};
  const equipmentType = eq.type || "";
  const equipmentBrand = eq.brand || "";
  const equipmentModel = eq.model || "";
  const equipmentSerial = eq.serialNumber || eq.serial_number || eq.serial || "";

  const rawMalfunctions: string[] = Array.isArray(order.malfunctions)
    ? order.malfunctions
    : typeof order.malfunctions === "string" && order.malfunctions.trim()
      ? [order.malfunctions.trim()]
      : [];
  const malfunctionsStr = rawMalfunctions.join(", ");

  const rawDefectDesc = String(
    order.defectDescription || order.defect_description || "",
  ).trim();

  // Primary defect / service (e.g. "Профилактика")
  const defectDescription =
    malfunctionsStr ||
    rawDefectDesc ||
    DEFAULT_PREVIEW_SAMPLE_DATA.defectDescription;

  // Additional defect description (details со слов клиента if distinct from main tag)
  const additionalDefectDescription =
    rawDefectDesc && rawDefectDesc !== malfunctionsStr
      ? rawDefectDesc
      : undefined;

  const appearance = eq.appearance || "";
  const packageContents =
    eq.packageContents ||
    eq.package_contents ||
    (Array.isArray(eq.packageContentsItems) ? eq.packageContentsItems.join(", ") : "") ||
    "";

  const masterName =
    order.masterName ||
    order.master_name ||
    DEFAULT_PREVIEW_SAMPLE_DATA.masterName;

  const estimatedCost = Number(
    order.estimatedCost ??
      order.estimated_cost ??
      order.finalCost ??
      order.final_cost ??
      0,
  );

  const rawWorks = order.works || order.work_items || [];
  const works =
    Array.isArray(rawWorks) && rawWorks.length > 0
      ? rawWorks.map((w: any, idx: number) => {
          const qty = Number(w.quantity ?? 1) || 1;
          const price = Number(w.unitPrice ?? w.unit_price ?? w.cost ?? 0);
          const total = Number(w.cost ?? qty * price);
          return {
            id: String(w.id || `w-${idx}`),
            name: String(w.description || w.name || `Работа ${idx + 1}`),
            qty,
            unit: String(w.unit || "усл."),
            price,
            total,
          };
        })
      : DEFAULT_PREVIEW_SAMPLE_DATA.works;

  const rawParts = order.parts || order.parts_used || [];
  const parts =
    Array.isArray(rawParts) && rawParts.length > 0
      ? rawParts.map((p: any, idx: number) => {
          const qty = Number(p.quantity ?? 1) || 1;
          const price = Number(p.retailPrice ?? p.retail_price ?? p.price ?? 0);
          const total = Number(p.total ?? qty * price);
          return {
            id: String(p.id || `p-${idx}`),
            name: String(p.name || p.article || `Запчасть ${idx + 1}`),
            qty,
            unit: String(p.unit || "шт."),
            price,
            total,
          };
        })
      : DEFAULT_PREVIEW_SAMPLE_DATA.parts;

  const toolInfo =
    order.toolInfo ||
    order.tool_info ||
    [equipmentType, equipmentBrand, equipmentModel].filter(Boolean).join(" ") +
      (equipmentSerial ? ` (S/N: ${equipmentSerial})` : "");

  const clientCompanyPart = companyName
    ? `${companyName}${companyInn ? ` (ИНН: ${companyInn})` : ""}`
    : "";

  const clientInfo =
    order.clientInfo ||
    order.client_info ||
    [
      clientCompanyPart,
      customerName ? (companyName ? `Представитель: ${customerName}` : customerName) : "",
      customerPhone ? `тел. ${customerPhone}` : "",
    ]
      .filter(Boolean)
      .join(", ") ||
    customerName;

  const notes = String(order.notes || order.note || "").trim();
  const comments =
    order.comments ||
    order.comment ||
    order.intakeComments ||
    order.intake_comments ||
    notes ||
    "";

  return {
    orderNumber,
    orderDate,
    customerName,
    customerPhone,
    customerEmail,
    customerAddress,
    customerPassport,
    companyName: companyName || undefined,
    companyInn: companyInn || undefined,
    equipmentType,
    equipmentBrand,
    equipmentModel,
    equipmentSerial,
    malfunctions: rawMalfunctions.length > 0 ? rawMalfunctions : undefined,
    defectDescription,
    additionalDefectDescription,
    appearance,
    packageContents,
    masterName,
    estimatedCost,
    toolInfo,
    clientInfo,
    notes: notes || undefined,
    comments,
    works,
    parts,
  };
}

// ---------------------------------------------------------------------------
// Client Russian Number to Words Formatter
// ---------------------------------------------------------------------------

export function numberToWordsRu(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  const rubles = Math.floor(rounded);
  const kopecks = Math.round((rounded - rubles) * 100);

  const unitsM = ["", "один", "два", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"];
  const unitsF = ["", "одна", "две", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"];
  const teens = [
    "десять",
    "одиннадцать",
    "двенадцать",
    "тринадцать",
    "четырнадцать",
    "пятнадцать",
    "шестнадцать",
    "семнадцать",
    "восемнадцать",
    "девятнадцать",
  ];
  const tens = ["", "", "двадцать", "тридцать", "сорок", "пятьдесят", "шестьдесят", "семьдесят", "восемьдесят", "девяносто"];
  const hundreds = [
    "",
    "сто",
    "двести",
    "триста",
    "четыреста",
    "пятьсот",
    "шестьсот",
    "семьсот",
    "восемьсот",
    "девятьсот",
  ];

  function triplet(num: number, gender: "m" | "f"): string {
    const h = Math.floor(num / 100);
    const rem = num % 100;
    const t = Math.floor(rem / 10);
    const u = rem % 10;
    const parts: string[] = [];

    if (h > 0) parts.push(hundreds[h] ?? "");
    if (t === 1) {
      parts.push(teens[u] ?? "");
    } else {
      if (t > 1) parts.push(tens[t] ?? "");
      const uArr = gender === "f" ? unitsF : unitsM;
      if (u > 0) parts.push(uArr[u] ?? "");
    }
    return parts.filter(Boolean).join(" ");
  }

  function decline(num: number, one: string, two: string, five: string): string {
    const rem100 = num % 100;
    const rem10 = num % 10;
    if (rem100 >= 11 && rem100 <= 19) return five;
    if (rem10 === 1) return one;
    if (rem10 >= 2 && rem10 <= 4) return two;
    return five;
  }

  if (rubles === 0) {
    const kopStr = String(kopecks).padStart(2, "0");
    const kopWord = decline(kopecks, "копейка", "копейки", "копеек");
    return `Ноль рублей ${kopStr} ${kopWord}`;
  }

  const millions = Math.floor(rubles / 1_000_000);
  const thousands = Math.floor((rubles % 1_000_000) / 1_000);
  const ones = rubles % 1_000;

  const resultParts: string[] = [];
  if (millions > 0) {
    resultParts.push(triplet(millions, "m"));
    resultParts.push(decline(millions, "миллион", "миллиона", "миллионов"));
  }
  if (thousands > 0) {
    resultParts.push(triplet(thousands, "f"));
    resultParts.push(decline(thousands, "тысяча", "тысячи", "тысяч"));
  }
  if (ones > 0) {
    resultParts.push(triplet(ones, "m"));
  }

  const rubWord = decline(rubles, "рубль", "рубля", "рублей");
  resultParts.push(rubWord);

  const kopStr = String(kopecks).padStart(2, "0");
  const kopWord = decline(kopecks, "копейка", "копейки", "копеек");
  resultParts.push(`${kopStr} ${kopWord}`);

  const str = resultParts.filter(Boolean).join(" ");
  return str.charAt(0).toUpperCase() + str.slice(1);
}
