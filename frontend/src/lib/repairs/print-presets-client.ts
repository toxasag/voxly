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
  description: "Официальный бланк приема техники на диагностику с перечнем дефектов и отрывным талоном",
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
      margins: "normal",
      accentHeaders: true,
      showBorders: true,
    },
    header: {
      showLogo: true,
      logoUrl: "/service-logo.png",
      logoWidth: 130,
      showCompanyDetails: true,
      companyName: "Ремонт инструмента ИП Сагайдак А.Г.",
      companyAddress: "Москва, 3-й проезд Марьиной рощи 40с1, 2 этаж, каб. 214",
      companyPhone: "+7 977 628 20 49",
      companyEmail: "info@remont-instrument.ru",
      companyWebsite: "РЕМОНТ-ИНСТРУМЕНТ.РФ",
      companyInn: "771501234567",
      companyOgrn: "318774600123456",
      workingHours: "Пн-Пт 10:00-19:00",
      documentTitle: "АКТ ПРИЕМА-ПЕРЕДАЧИ ОБОРУДОВАНИЯ",
      documentSubtitle: "Заказ-наряд на проведение диагностики и ремонтных работ",
      showDate: true,
      showDocNumber: true,
    },
    customer: {
      visible: true,
      title: "Заказчик / Клиент",
      showName: true,
      showPhone: true,
      showEmail: false,
      showAddress: false,
      showPassport: false,
    },
    equipment: {
      visible: true,
      title: "Оборудование и неисправность",
      showTypeBrandModel: true,
      showSerial: true,
      showDefect: true,
      showAppearance: true,
      showPackage: true,
      showMaster: true,
      showEstimatedCost: true,
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
      showWorks: true,
      showParts: false,
      showVat: false,
      vatRate: 20,
      showDiscount: false,
      showTotals: true,
      showGrandTotalWords: true,
    },
    terms: {
      visible: true,
      title: "Условия приема и диагностики",
      termsText:
        "1. Сервисный центр производит диагностику и устранение заявленных дефектов. При обнаружении скрытых повреждений стоимость и сроки согласуются дополнительно.\n2. Сервисный центр не несет ответственности за возможную потерю данных на внутренних накопителях.\n3. Срок бесплатного хранения готового оборудования — 14 дней с момента уведомления клиента.",
      showPdnConsent: true,
      pdnText:
        "Заказчик подтверждает согласие на обработку персональных данных в соответствии с ФЗ №152-ФЗ для исполнения договора оказания услуг.",
      showWarrantyText: false,
      warrantyDays: 30,
    },
    signatures: {
      visible: true,
      showExecutor: true,
      executorTitle: "Приемщик СЦ",
      showClient: true,
      clientTitle: "Заказчик (с условиями ознакомлен)",
      showStamp: true,
      stampText: "М.П.",
    },
    tearOffTicket: {
      visible: true,
      title: "ОТРЫВНОЙ ТАЛОН КЛИЕНТА",
      showBarcodeOrQr: true,
      customNote:
        "Предъявите данный талон при получении оборудования из сервисного центра. Без талона выдача производится только по паспорту Заказчика.",
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
      logoUrl: "/service-logo.png",
      logoWidth: 130,
      showCompanyDetails: true,
      companyName: "Ремонт инструмента ИП Сагайдак А.Г.",
      companyAddress: "Москва, 3-й проезд Марьиной рощи 40с1, 2 этаж, каб. 214",
      companyPhone: "+7 977 628 20 49",
      companyEmail: "info@remont-instrument.ru",
      companyWebsite: "РЕМОНТ-ИНСТРУМЕНТ.РФ",
      companyInn: "771501234567",
      companyOgrn: "318774600123456",
      workingHours: "Пн-Пт 10:00-19:00",
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
      logoUrl: "/service-logo.png",
      logoWidth: 130,
      showCompanyDetails: true,
      companyName: "Ремонт инструмента ИП Сагайдак А.Г.",
      companyAddress: "Москва, 3-й проезд Марьиной рощи 40с1, 2 этаж, каб. 214",
      companyPhone: "+7 977 628 20 49",
      companyEmail: "info@remont-instrument.ru",
      companyWebsite: "РЕМОНТ-ИНСТРУМЕНТ.РФ",
      companyInn: "771501234567",
      companyOgrn: "318774600123456",
      workingHours: "Пн-Пт 10:00-19:00",
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
      logoUrl: "/service-logo.png",
      logoWidth: 120,
      showCompanyDetails: true,
      companyName: "Ремонт инструмента ИП Сагайдак А.Г.",
      companyAddress: "Москва, 3-й проезд Марьиной рощи 40с1",
      companyPhone: "+7 977 628 20 49",
      companyEmail: "info@remont-instrument.ru",
      companyWebsite: "РЕМОНТ-ИНСТРУМЕНТ.РФ",
      companyInn: "771501234567",
      companyOgrn: "318774600123456",
      workingHours: "Пн-Пт 10:00-19:00",
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
  REPAIR_ORDER_CLIENT_PRESET,
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
  equipmentType: string;
  equipmentBrand: string;
  equipmentModel: string;
  equipmentSerial: string;
  defectDescription: string;
  appearance: string;
  packageContents: string;
  masterName: string;
  estimatedCost: number;
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
  orderNumber: "№1042",
  orderDate: new Date().toLocaleDateString("ru-RU"),
  customerName: "Константинопольский Александр Сергеевич",
  customerPhone: "+7 (999) 123-45-67",
  customerEmail: "client@example.com",
  customerAddress: "г. Москва, ул. Тверская, д. 12, кв. 45",
  customerPassport: "45 10 № 123456, выдан ОВД Тверского района г. Москвы 15.04.2015",
  equipmentType: "Перфоратор",
  equipmentBrand: "Bosch",
  equipmentModel: "GBH 2-26 DRE Professional",
  equipmentSerial: "SN-948271038",
  defectDescription: "Не включается при нажатии курка пуска, искрит в районе коллектора двигателя",
  appearance: "Б/у, потертости пластикового корпуса, незначительные следы строительной пыли",
  packageContents: "Фирменный пластиковый кейс, дополнительная рукоятка, ограничитель глубины",
  masterName: "Иванов Алексей (Мастер 1 категории)",
  estimatedCost: 4500,
  works: [
    {
      id: "w1",
      name: "Комплексная диагностика электродвигателя и узлов редуктора",
      qty: 1,
      unit: "усл.",
      price: 800,
      total: 800,
    },
    {
      id: "w2",
      name: "Замена щеточного узла и перепайка выводов статора",
      qty: 1,
      unit: "усл.",
      price: 1200,
      total: 1200,
    },
    {
      id: "w3",
      name: "Чистка и смазка редуктора высокотемпературной смазкой",
      qty: 1,
      unit: "усл.",
      price: 1000,
      total: 1000,
    },
  ],
  parts: [
    {
      id: "p1",
      name: "Комплект графитовых щеток Bosch 1617014138",
      qty: 1,
      unit: "компл.",
      price: 650,
      total: 650,
    },
    {
      id: "p2",
      name: "Подшипник ротора 608-2RS SKF",
      qty: 1,
      unit: "шт.",
      price: 450,
      total: 450,
    },
  ],
};

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
