export interface MonthlyPnL {
  month: string;
  revenue: number;
  expenses: number;
  profit: number;
}

export interface FunnelStep {
  name: string;
  count: number;
  percentage: number;
}

export interface TopRepairDefect {
  name: string;
  count: number;
  avg_cost: number;
}

export interface MasterLoad {
  name: string;
  active: number;
  completed: number;
}

export const MOCK_KPIS = {
  revenue: 2850000,
  revenue_change: 14.5,
  net_profit: 920000,
  profit_change: 22.3,
  closed_repairs: 187,
  repairs_change: 8.1,
  avg_ticket: 15240,
  ticket_change: -2.4,
};

export const MOCK_PNL_DATA: MonthlyPnL[] = [
  { month: "Янв", revenue: 1950000, expenses: 1520000, profit: 430000 },
  { month: "Фев", revenue: 2100000, expenses: 1605000, profit: 495000 },
  { month: "Мар", revenue: 2250000, expenses: 1710000, profit: 540000 },
  { month: "Апр", revenue: 2400000, expenses: 1820000, profit: 580000 },
  { month: "Май", revenue: 2580000, expenses: 1900000, profit: 680000 },
  { month: "Июн", revenue: 2720000, expenses: 1980000, profit: 740000 },
  { month: "Июл", revenue: 2650000, expenses: 1950000, profit: 700000 },
  { month: "Авг", revenue: 2850000, expenses: 1930000, profit: 920000 },
];

// Этапы совпадают с воронкой по умолчанию из `ensureTenantDefaults`: расхождение
// между демо-данными и реальной воронкой сбивало бы с толку.
export const MOCK_FUNNEL: FunnelStep[] = [
  { name: "Новые", count: 320, percentage: 100 },
  { name: "В работе", count: 256, percentage: 80 },
  { name: "Согласование", count: 182, percentage: 57 },
  { name: "Оплата", count: 128, percentage: 40 },
  { name: "Успешно закрыто", count: 97, percentage: 30 },
];

export const MOCK_TOP_REPAIRS: TopRepairDefect[] = [
  { name: "Замена экрана", count: 48, avg_cost: 8500 },
  { name: "Замена аккумулятора", count: 35, avg_cost: 4500 },
  { name: "Ремонт клавиатуры", count: 28, avg_cost: 6200 },
  { name: "Ремонт разъёма зарядки", count: 22, avg_cost: 2500 },
  { name: "Чистка после залития", count: 18, avg_cost: 12000 },
];

export const MOCK_MASTER_LOAD: MasterLoad[] = [
  { name: "Иван Петров", active: 12, completed: 87 },
  { name: "Елена Козлова", active: 8, completed: 94 },
  { name: "Андрей Соколов", active: 15, completed: 72 },
  { name: "Сергей Волков", active: 5, completed: 56 },
  { name: "Анна Морозова", active: 10, completed: 63 },
];