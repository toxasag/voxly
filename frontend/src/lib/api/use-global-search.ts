"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { apiClient, ApiClientError } from "@/lib/api/apiClient";
import type { ContactDTO } from "@/lib/api/use-contacts";
import type { CompanyDTO } from "@/lib/api/use-companies";
import type { DealDTO } from "@/lib/api/use-deals";
import type { RepairOrderDTO } from "@/lib/api/use-repairs";
import type { TaskDTO } from "@/lib/api/use-tasks";

// ---------------------------------------------------------------------------
// Поиск для палитры (⌘K) — по реальным данным арендатора.
//
// Что было. `searchEntities` в `CommandMenu.tsx` фильтровала три массива из
// `lib/crm/mock-deals.ts` и `lib/repairs/mock-repairs.ts`: вымышленные сделки,
// контакты и ремонты. Найденная запись открывала список раздела, а не саму
// запись, потому что перехода по id не было вовсе (`ENTITY_HREF` содержал
// `/crm/deals`, `/crm/contacts`, `/repairs` без идентификатора).
//
// Почему это стало срочным: поиск — одна из трёх кнопок мобильного бара, то есть
// на телефоне главный путь навигации. Заглушка там означает, что основной способ
// найти запись показывает несуществующие данные.
//
// Четыре запроса параллельно, а не один сводный эндпоинт: сводного на бэкенде нет,
// а добавлять его — отдельная работа с полнотекстовым индексом по нескольким
// таблицам. Каждый список уже умеет `?search=`, и параллельные запросы дают тот же
// результат без изменения контракта API.
//
// Ремонты запрашиваются только при установленном модуле: без него эндпоинт
// отвечает 403 `MODULE_NOT_INSTALLED`, и запрос был бы гарантированно неудачным.
// ---------------------------------------------------------------------------

/** Сколько записей просить у каждого источника. */
const PER_SOURCE_LIMIT = 5;

export type SearchResultKind = "deal" | "contact" | "company" | "repair" | "task";

export interface SearchResult {
  kind: SearchResultKind;
  id: string;
  title: string;
  subtitle: string;
  /** Адрес самой записи, а не списка раздела. */
  href: string;
}

export const searchKeys = {
  all: ["global-search"] as const,
  query: (query: string, withRepairs: boolean) =>
    [...searchKeys.all, query, withRepairs] as const,
};

/** ФИО контакта одной строкой; отчество опускается — в списке оно не нужно. */
function contactTitle(contact: ContactDTO): string {
  const name = `${contact.firstName} ${contact.lastName}`.trim();
  return name.length > 0 ? name : "Без имени";
}

function toDealResult(deal: DealDTO): SearchResult {
  const parts = [deal.contactName, deal.companyName].filter(
    (value): value is string => value !== null && value.length > 0,
  );

  return {
    kind: "deal",
    id: deal.id,
    title: deal.title,
    subtitle: parts.length > 0 ? `Сделка · ${parts.join(" · ")}` : "Сделка",
    href: `/crm/deals/${deal.id}`,
  };
}

function toContactResult(contact: ContactDTO): SearchResult {
  const detail = contact.companyName.length > 0 ? contact.companyName : contact.phone;

  return {
    kind: "contact",
    id: contact.id,
    title: contactTitle(contact),
    subtitle: detail.length > 0 ? `Контакт · ${detail}` : "Контакт",
    // `?record=` вместо отдельной страницы: карточка контакта открывается панелью
    // на странице списка, своего маршрута у неё нет.
    href: `/crm/contacts?record=${contact.id}`,
  };
}

function toCompanyResult(company: CompanyDTO): SearchResult {
  return {
    kind: "company",
    id: company.id,
    title: company.name,
    subtitle:
      company.managerName.length > 0 ? `Компания · ${company.managerName}` : "Компания",
    href: `/crm/companies?record=${company.id}`,
  };
}

function toRepairResult(order: RepairOrderDTO): SearchResult {
  const equipment = `${order.equipment.brand} ${order.equipment.model}`.trim();

  return {
    kind: "repair",
    id: order.id,
    title: equipment.length > 0 ? `${order.ticketNumber} — ${equipment}` : order.ticketNumber,
    subtitle: `Ремонт · ${order.customerName}`,
    href: `/repairs/${order.id}`,
  };
}

function toTaskResult(task: TaskDTO): SearchResult {
  return {
    kind: "task",
    id: task.id,
    title: task.title,
    subtitle: task.dueDate === null ? "Задача" : `Задача · срок ${task.dueDate.slice(0, 10)}`,
    // У задач своей страницы нет: модальная форма открывается по адресу списка.
    href: `/crm/tasks?record=${task.id}`,
  };
}

/**
 * Запрос к одному источнику.
 *
 * Отказ по правам и по модулю проглатывается: у пользователя может не быть права
 * на сделки, но быть на контакты, и тогда 403 означает «здесь искать нечего», а не
 * «поиск сломан».
 *
 * Всё остальное — сеть не отвечает, сервер вернул 500 — пробрасывается наружу.
 * Иначе недоступный бэкенд выглядел бы как «ничего не найдено»: пользователь
 * решил бы, что записи нет, и завёл её второй раз. Ровно на этом попался первый
 * вариант функции — она глотала любую ошибку, и состояние отказа в палитре было
 * недостижимым мёртвым кодом.
 */
async function fetchSource<T>(
  path: string,
  query: Record<string, string | number>,
): Promise<T[]> {
  try {
    const response = await apiClient.get<T[]>(path, { query });
    return response.data;
  } catch (error) {
    const status = error instanceof ApiClientError ? error.status : 0;

    // 403 — нет права или модуль не установлен, 404 — раздела нет вовсе.
    if (status === 403 || status === 404) return [];

    throw error;
  }
}

/**
 * Поиск по сделкам, контактам, компаниям и ремонтам.
 *
 * `query` передаётся уже с задержкой ввода (вызывающий отвечает за дебаунс):
 * запрос на каждое нажатие клавиши означал бы четыре обращения к API за символ.
 */
export function useGlobalSearch(
  query: string,
  options: { includeRepairs: boolean },
): UseQueryResult<SearchResult[], ApiClientError> {
  const trimmed = query.trim();
  const { includeRepairs } = options;

  return useQuery({
    queryKey: searchKeys.query(trimmed, includeRepairs),
    // Пустой запрос не отправляется: палитра при пустом поле показывает
    // навигацию и быстрые действия, а не результаты.
    enabled: trimmed.length > 0,
    // Результаты живут минуту: за это время пользователь успевает вернуться к
    // тому же запросу, а данные не успевают устареть настолько, чтобы это мешало.
    staleTime: 60_000,
    queryFn: async (): Promise<SearchResult[]> => {
      const search = { search: trimmed, limit: PER_SOURCE_LIMIT, offset: 0 };

      const [deals, contacts, companies, repairs, tasks] = await Promise.all([
        fetchSource<DealDTO>("/api/v1/crm/deals", search),
        fetchSource<ContactDTO>("/api/v1/crm/contacts", search),
        fetchSource<CompanyDTO>("/api/v1/crm/companies", search),
        includeRepairs
          ? fetchSource<RepairOrderDTO>("/api/v1/repairs", search)
          : Promise.resolve([]),
        fetchSource<TaskDTO>("/api/v1/crm/tasks", search),
      ]);

      // Порядок групп фиксирован: сделки и контакты — то, что ищут чаще всего, и
      // они должны быть первыми под курсором при нажатии Enter.
      return [
        ...deals.map(toDealResult),
        ...contacts.map(toContactResult),
        ...companies.map(toCompanyResult),
        ...tasks.map(toTaskResult),
        ...repairs.map(toRepairResult),
      ];
    },
  });
}
