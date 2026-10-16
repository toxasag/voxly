// MOCK_REPAIR_TICKETS удалён вместе с переводом палитры поиска на реальные
// данные: он был её единственным потребителем. Остальные наборы ниже —
// справочники мастеров, типов оборудования и каталогов работ, которые ещё держат
// формы приёмки; они уйдут вместе со своими эндпоинтами.

export const MOCK_MASTERS = [
  { id: "m1", name: "Ivan Petrov" },
  { id: "m3", name: "Andrey Sokolov" },
];

export const MOCK_EQUIPMENT_TYPES = [
  "Smartphone",
  "Tablet",
  "Laptop",
  "Desktop PC",
  "Monitor",
  "Printer",
  "Server",
  "Camera",
  "Smartwatch",
  "Wireless Headphones",
  "Game Console",
  "Other",
] as const;

export const MOCK_CUSTOMERS_FOR_REPAIR = [
  { id: "c1", name: "Maria Sokolova", phone: "+7 916 123 45 67" },
  { id: "c2", name: "Alexey Smirnov", phone: "+7 903 234 56 78" },
  { id: "c3", name: "Dmitry Volkov", phone: "+7 905 345 67 89" },
  { id: "c4", name: "Olga Petrova", phone: "+7 906 456 78 90" },
  { id: "c5", name: "Sergey Ivanov", phone: "+7 910 567 89 01" },
  { id: "c6", name: "Anna Morozova", phone: "+7 916 678 90 12" },
  { id: "c7", name: "Pavel Orlov", phone: "+7 903 789 01 23" },
  { id: "c8", name: "Igor Fedorov", phone: "+7 905 890 12 34" },
  { id: "c9", name: "Natalia Gromova", phone: "+7 906 901 23 45" },
  { id: "c10", name: "Maxim Belov", phone: "+7 910 012 34 56" },
];

export const WORK_CATALOG = [
  { id: "wc1", description: "Full device diagnostics (multimeter, component test)", cost: 1500 },
  { id: "wc2", description: "Screen assembly replacement (heat + suction)", cost: 2500 },
  { id: "wc3", description: "Battery replacement with OEM adhesive", cost: 1800 },
  { id: "wc4", description: "Charging port module replacement (micro-soldering)", cost: 2200 },
  { id: "wc5", description: "Keyboard / topcase replacement", cost: 3500 },
  { id: "wc6", description: "Liquid damage ultrasonic cleaning", cost: 3000 },
  { id: "wc7", description: "Component-level motherboard repair", cost: 5000 },
  { id: "wc8", description: "Firmware flash / OS reinstall", cost: 800 },
  { id: "wc9", description: "Camera module replacement", cost: 2000 },
  { id: "wc10", description: "Post-repair QC testing (48h burn-in)", cost: 1200 },
];

export const PARTS_CATALOG = [
  { id: "pc1", name: "Samsung Service Pack (Screen + Frame) Galaxy S24U", article: "GH82-31502A", retail_price: 14500, cost_price: 9800 },
  { id: "pc2", name: "Samsung OEM IP68 Adhesive Kit S24U", article: "GH81-23871B", retail_price: 800, cost_price: 450 },
  { id: "pc3", name: "Apple Topcase with Battery MacBook Pro 16\" M3", article: "661-39482", retail_price: 28500, cost_price: 19200 },
  { id: "pc4", name: "iPad Pro 12.9\" Battery OEM", article: "616-00542", retail_price: 8500, cost_price: 5800 },
  { id: "pc5", name: "Sony WH-1000XM5 Right Driver Unit", article: "1-009-483-12", retail_price: 3500, cost_price: 2200 },
  { id: "pc6", name: "USB-C Port Module (Universal 24-pin)", article: "USB-C-GEN4", retail_price: 1200, cost_price: 650 },
  { id: "pc7", name: "Dell PowerEdge 1100W Hot-Swap PSU", article: "DELL-1100W-R750", retail_price: 28000, cost_price: 19500 },
  { id: "pc8", name: "Canon EOS R6 II Lens Mount Contact Assembly", article: "CN-LMCA-R6M2", retail_price: 4200, cost_price: 2800 },
  { id: "pc9", name: "Apple Watch Crown Mechanism Assembly", article: "661-28371", retail_price: 6500, cost_price: 4200 },
  { id: "pc10", name: "HP LaserJet Maintenance Kit (Rollers + Fuser)", article: "HP-MK-M404", retail_price: 3800, cost_price: 2400 },
];