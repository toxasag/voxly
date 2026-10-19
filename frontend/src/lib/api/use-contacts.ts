"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { apiClient, type ApiClientError, type ApiMeta } from "@/lib/api/apiClient";
import type {
  ContactChannel,
  CreateContactPayload,
  SocialKind,
  UpdateContactPayload,
} from "@/schemas/contact.schema";

// ---------------------------------------------------------------------------
// DTOs — mirror backend/src/modules/crm/contacts/contacts.types.ts.
//
// The API answers in camelCase; the DTO is used as-is rather than mapped back
// to snake_case, so there is one shape per concept and no silent drift.
// ---------------------------------------------------------------------------

/** Twenty: элемент composite-поля PHONES. Основной номер — первый в списке. */
export interface ContactPhoneDTO {
  number: string;
  countryCode: string;
  callingCode: string;
  isPrimary: boolean;
}

export interface ContactSocialDTO {
  kind: SocialKind;
  value: string;
}

export interface ContactDTO {
  id: string;
  firstName: string;
  lastName: string;
  middleName: string;
  /** Основной номер: он же первый элемент `phones`. */
  phone: string;
  phones: ContactPhoneDTO[];
  email: string | null;
  telegramUsername: string | null;
  whatsapp: string | null;
  socials: ContactSocialDTO[];
  jobTitle: string;
  companyName: string;
  companyId: string | null;
  channel: ContactChannel;
  /** Twenty: person.linkedinLink, группа social на карточке. */
  linkedinLink: string;
  customFields: Record<string, unknown>;
  notes: string;
  /** Twenty: person.createdBy — автор записи, группа system. */
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
  /** Сколько сделок ведётся через этот контакт. */
  dealsCount: number;
  /** Сколько задач привязано к контакту. */
  tasksCount: number;
}

export interface ContactsListResult {
  items: ContactDTO[];
  total: number;
  limit: number;
  offset: number;
}

export interface ContactsQueryParams {
  search?: string;
  companyId?: string;
  channel?: ContactChannel;
  limit?: number;
  offset?: number;
}

/** Metadata returned by DELETE when the contact still had linked deals. */
export interface DeleteContactResult {
  id: string;
  linkedDeals: number;
  warning: string | null;
}

const BASE_PATH = "/api/v1/crm/contacts";

export const DEFAULT_PAGE_SIZE = 25;

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const contactKeys = {
  all: ["contacts"] as const,
  list: (params: ContactsQueryParams) => ["contacts", "list", params] as const,
  detail: (id: string) => ["contacts", "detail", id] as const,
};

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Paginated contact list.
 *
 * Search, channel filter and pagination are applied server-side, so the page
 * no longer filters a fully loaded array in memory.
 */
export function useContacts(
  params: ContactsQueryParams = {},
): UseQueryResult<ContactsListResult, ApiClientError> {
  const limit = params.limit ?? DEFAULT_PAGE_SIZE;
  const offset = params.offset ?? 0;

  return useQuery<ContactsListResult, ApiClientError>({
    queryKey: contactKeys.list({ ...params, limit, offset }),
    queryFn: async () => {
      const res = await apiClient.get<ContactDTO[]>(BASE_PATH, {
        query: {
          search: params.search,
          company_id: params.companyId,
          channel: params.channel,
          limit,
          offset,
        },
      });

      const meta: ApiMeta = res.meta ?? {};

      return {
        items: res.data,
        total: typeof meta.total === "number" ? meta.total : res.data.length,
        limit: typeof meta.limit === "number" ? meta.limit : limit,
        offset: typeof meta.offset === "number" ? meta.offset : offset,
      };
    },
    // Keeps the previous page visible while the next one loads, instead of
    // collapsing the table into a skeleton on every page change.
    placeholderData: (previous) => previous,
  });
}

export function useContact(
  id: string | null,
): UseQueryResult<ContactDTO, ApiClientError> {
  return useQuery<ContactDTO, ApiClientError>({
    queryKey: contactKeys.detail(id ?? ""),
    queryFn: async () => {
      const res = await apiClient.get<ContactDTO>(`${BASE_PATH}/${id ?? ""}`);
      return res.data;
    },
    enabled: id !== null && id.length > 0,
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function useCreateContact(): UseMutationResult<
  ContactDTO,
  ApiClientError,
  CreateContactPayload
> {
  const queryClient = useQueryClient();

  return useMutation<ContactDTO, ApiClientError, CreateContactPayload>({
    mutationFn: async (payload) => {
      const res = await apiClient.post<ContactDTO>(BASE_PATH, payload);
      return res.data;
    },
    onSuccess: () => {
      // Invalidating the root key refreshes every cached page and filter
      // combination; a new contact can land on any of them.
      void queryClient.invalidateQueries({ queryKey: contactKeys.all });
    },
  });
}

export interface UpdateContactVariables {
  id: string;
  payload: UpdateContactPayload;
}

export function useUpdateContact(): UseMutationResult<
  ContactDTO,
  ApiClientError,
  UpdateContactVariables
> {
  const queryClient = useQueryClient();

  return useMutation<ContactDTO, ApiClientError, UpdateContactVariables>({
    mutationFn: async ({ id, payload }) => {
      const res = await apiClient.patch<ContactDTO>(`${BASE_PATH}/${id}`, payload);
      return res.data;
    },
    onSuccess: (contact) => {
      queryClient.setQueryData(contactKeys.detail(contact.id), contact);
      void queryClient.invalidateQueries({ queryKey: contactKeys.all });
    },
  });
}

/**
 * Soft delete.
 *
 * The backend answers 204 when nothing referenced the contact, and 200 with a
 * cascade warning in `meta` when open deals still pointed at it — both are
 * normalised here so callers get one shape.
 */
export function useDeleteContact(): UseMutationResult<
  DeleteContactResult,
  ApiClientError,
  string
> {
  const queryClient = useQueryClient();

  return useMutation<DeleteContactResult, ApiClientError, string>({
    mutationFn: async (id) => {
      const res = await apiClient.delete<{ id: string; deleted: boolean } | undefined>(
        `${BASE_PATH}/${id}`,
      );

      const meta: ApiMeta = res.meta ?? {};

      return {
        id,
        linkedDeals: typeof meta.linkedDeals === "number" ? meta.linkedDeals : 0,
        warning: typeof meta.warning === "string" ? meta.warning : null,
      };
    },
    onSuccess: (result) => {
      queryClient.removeQueries({ queryKey: contactKeys.detail(result.id) });
      void queryClient.invalidateQueries({ queryKey: contactKeys.all });
    },
  });
}

export interface MergeContactsPayload {
  primary_id: string;
  loser_ids: string[];
}

export interface MergeContactsResult {
  primaryContactId: string;
  mergedContactIds: string[];
  dealsRetargeted: number;
  tasksRetargeted: number;
  phonesAdded: number;
  socialsAdded: number;
}

export function useMergeContacts(): UseMutationResult<
  MergeContactsResult,
  ApiClientError,
  MergeContactsPayload
> {
  const queryClient = useQueryClient();

  return useMutation<MergeContactsResult, ApiClientError, MergeContactsPayload>({
    mutationFn: async (payload) => {
      const res = await apiClient.post<MergeContactsResult>(`${BASE_PATH}/merge`, payload);
      return res.data;
    },
    onSuccess: (result) => {
      queryClient.removeQueries({ queryKey: contactKeys.detail(result.primaryContactId) });
      for (const loserId of result.mergedContactIds) {
        queryClient.removeQueries({ queryKey: contactKeys.detail(loserId) });
      }
      void queryClient.invalidateQueries({ queryKey: contactKeys.all });
    },
  });
}

export function useFindDuplicateContacts(
  phone: string | null | undefined,
  excludeId?: string,
): UseQueryResult<ContactDTO[], ApiClientError> {
  return useQuery<ContactDTO[], ApiClientError>({
    queryKey: ["contacts", "duplicates", phone, excludeId] as const,
    queryFn: async () => {
      if (!phone) return [];
      const res = await apiClient.get<ContactDTO[]>(
        `${BASE_PATH}/duplicates?phone=${encodeURIComponent(phone)}${excludeId ? `&exclude_id=${excludeId}` : ""}`,
      );
      return res.data;
    },
    enabled: Boolean(phone && phone.trim().length >= 4),
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * ФИО в порядке «Фамилия Имя Отчество».
 *
 * Порядок русский, а не как у Twenty (`firstName lastName`): в списках контактов
 * ищут по фамилии, и она должна стоять первой. Пустые части опускаются —
 * обязательно только имя.
 */
export function contactFullName(contact: ContactDTO): string {
  return [contact.lastName, contact.firstName, contact.middleName]
    .filter((part) => part !== "")
    .join(" ");
}

/** Короткое имя для чипов и заголовков: «Имя Фамилия», без отчества. */
export function contactShortName(contact: ContactDTO): string {
  return [contact.firstName, contact.lastName].filter((part) => part !== "").join(" ");
}

/** Prefills the edit form from a DTO, converting camelCase back to the payload shape. */
export function toContactFormValues(contact: ContactDTO): CreateContactPayload {
  const customFields: Record<string, string> = {};

  for (const [key, value] of Object.entries(contact.customFields)) {
    if (value !== null && value !== undefined) customFields[key] = String(value);
  }

  return {
    first_name: contact.firstName,
    last_name: contact.lastName,
    middle_name: contact.middleName,
    phones: contact.phones.map((phone) => ({
      number: phone.number,
      country_code: phone.countryCode,
      calling_code: phone.callingCode,
    })),
    email: contact.email ?? "",
    socials: contact.socials.map((social) => ({ kind: social.kind, value: social.value })),
    // job_title здесь отсутствовал: форма правки открывалась с пустой должностью
    // и PATCH затирал её при любом сохранении.
    job_title: contact.jobTitle,
    company_name: contact.companyName,
    company_id: contact.companyId ?? "",
    channel: contact.channel,
    linkedin_link: contact.linkedinLink,
    notes: contact.notes,
    custom_fields: customFields,
  };
}
