// ---------------------------------------------------------------------------
// Коннектор Контур.Эльба Public API (https://elba-api.kontur.ru/v1)
// Авторизация: заголовок X-Kontur-ApiKey.
// Спецификация: https://developer.kontur.ru/doc/elba.public.api
// ---------------------------------------------------------------------------

import { AppError } from "../../plugins/errorHandler.js";
import type { VatMode } from "./finance-organizations.types.js";

const ELBA_BASE_URL = "https://elba-api.kontur.ru/v1";
const REQUEST_TIMEOUT_MS = 20_000;

export interface ElbaOrganization {
  id: string;
  name: string;
  shortName?: string | null;
  inn?: string | null;
  kpp?: string | null;
  ogrn?: string | null;
  type?: string | null;
}

export interface ElbaBankAccount {
  id: string;
  accountNumber: string;
  closed: boolean;
  bank: {
    name?: string | null;
    bik?: string | null;
    corrAccount?: string | null;
    city?: string | null;
    cityType?: string | null;
  };
}

export interface ElbaContractor {
  id: string;
  name?: string | null;
  shortName?: string | null;
  inn?: string | null;
  kpp?: string | null;
}

export type ElbaNdsRate =
  | "withoutNds"
  | "nds0"
  | "nds5"
  | "nds10"
  | "nds20"
  | "nds22";

export interface ElbaBillItemInput {
  productName: string;
  unitName: string;
  quantity: number;
  price: number;
  ndsRate?: ElbaNdsRate | null;
}

export interface ElbaCreateBillInput {
  number?: string;
  date: string; // YYYY-MM-DD
  withNDS: boolean;
  sumsWithNDS?: boolean | null;
  comment?: string;
  bankAccountId?: string;
  contractorId?: string;
  warehouseItems: ElbaBillItemInput[];
}

export function buildCreateBillPayload(input: ElbaCreateBillInput): Record<string, unknown> {
  const withNDS = Boolean(input.withNDS);
  const body: Record<string, unknown> = {
    date: input.date,
    withNDS,
    warehouseItems: input.warehouseItems.map((item) => ({
      productName: item.productName.trim().slice(0, 2000) || "Позиция",
      unitName: item.unitName.trim().slice(0, 1000) || "шт.",
      quantity: item.quantity,
      price: item.price,
      // По OpenAPI Контур.Эльбы для счёта без НДС (withNDS=false) поле ndsRate обязано быть null
      ndsRate: withNDS ? (item.ndsRate ?? "withoutNds") : null,
    })),
  };
  // По OpenAPI Контур.Эльбы в счёте без НДС цена не может включать НДС (sumsWithNDS=true даёт HTTP 400)
  if (withNDS) {
    body.sumsWithNDS = input.sumsWithNDS ?? true;
  } else {
    body.sumsWithNDS = null;
  }
  if (input.number && input.number.trim()) {
    body.number = input.number.trim().slice(0, 30);
  }
  if (input.comment && input.comment.trim()) {
    body.comment = input.comment.trim().slice(0, 10000);
  }
  if (input.bankAccountId && input.bankAccountId.trim()) {
    body.bankAccountId = input.bankAccountId.trim();
  }
  if (input.contractorId && input.contractorId.trim()) {
    body.contractorId = input.contractorId.trim();
  }
  return body;
}

export function mapVatModeToElbaNds(vatMode: VatMode, vatRate: number): ElbaNdsRate {
  if (vatMode === "none" || vatRate <= 0) return "withoutNds";
  if (vatRate === 5) return "nds5";
  if (vatRate === 10) return "nds10";
  if (vatRate === 22) return "nds22";
  if (vatRate === 20) return "nds20";
  return "nds5";
}

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function collectNestedElbaErrors(node: unknown, out: string[], depth = 0): void {
  if (depth > 4 || node === null || typeof node !== "object") return;
  const rec = asRecord(node);
  const msg = asString(rec.message).trim();
  const target = asString(rec.target).trim();
  if (msg) {
    out.push(target ? `${target}: ${msg}` : msg);
  }
  if (Array.isArray(rec.details)) {
    for (const item of rec.details) {
      collectNestedElbaErrors(item, out, depth + 1);
    }
  }
  if (rec.innerError && typeof rec.innerError === "object") {
    collectNestedElbaErrors(rec.innerError, out, depth + 1);
  }
}

export function extractElbaErrorMessage(parsed: unknown, status: number): string {
  const errObj = asRecord(parsed);
  const collected: string[] = [];

  if (errObj.error && typeof errObj.error === "object") {
    collectNestedElbaErrors(errObj.error, collected);
  }

  const unique = Array.from(new Set(collected.filter(Boolean)));
  if (unique.length > 0) {
    return unique.join("; ");
  }

  const flat =
    asString(errObj.message).trim() ||
    asString(errObj.title).trim() ||
    asString(errObj.error).trim() ||
    asString(errObj.raw).trim().slice(0, 300);

  return flat || `HTTP ${status}`;
}

async function elbaFetch<T>(
  apiKey: string,
  method: "GET" | "POST" | "PUT",
  endpoint: string,
  body?: unknown,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(`${ELBA_BASE_URL}${endpoint}`, {
      method,
      headers: {
        "X-Kontur-ApiKey": apiKey,
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const text = await res.text();
    let parsed: unknown = null;
    if (text.trim().length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { raw: text };
      }
    }

    if (!res.ok) {
      const errMsg = extractElbaErrorMessage(parsed, res.status);
      if (res.status === 401 || res.status === 403) {
        throw new AppError(
          400,
          "ELBA_AUTH_ERROR",
          `Контур.Эльба отклонила API-ключ (${res.status}): проверьте корректность ключа и тариф с доступом к API`,
        );
      }
      throw new AppError(
        502,
        "ELBA_API_ERROR",
        `Ошибка API Контур.Эльбы (${res.status}): ${errMsg}`,
      );
    }

    return parsed as T;
  } catch (err: unknown) {
    if (err instanceof AppError) throw err;
    const isAbort = err instanceof Error && err.name === "AbortError";
    throw new AppError(
      504,
      "ELBA_NETWORK_ERROR",
      isAbort
        ? "Таймаут запроса к API Контур.Эльбы"
        : `Не удалось подключиться к Контур.Эльбе: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    clearTimeout(timer);
  }
}

export class ElbaClient {
  async getOrganizations(apiKey: string): Promise<ElbaOrganization[]> {
    const data = await elbaFetch<unknown>(apiKey, "GET", "/organizations?limit=100&offset=0");
    const rec = asRecord(data);
    const list = Array.isArray(rec.organizations) ? rec.organizations : [];

    return list
      .map((item): ElbaOrganization | null => {
        const o = asRecord(item);
        const id = asString(o.id);
        if (!id) return null;
        const name = asString(o.fullName) || asString(o.name) || asString(o.shortName) || "Организация";
        return {
          id,
          name,
          shortName: asString(o.shortName) || null,
          inn: asString(o.inn) || null,
          kpp: asString(o.kpp) || null,
          ogrn: asString(o.ogrn) || null,
          type: asString(o.type) || null,
        };
      })
      .filter((x): x is ElbaOrganization => x !== null);
  }

  async getBankAccounts(apiKey: string, organizationId: string): Promise<ElbaBankAccount[]> {
    const data = await elbaFetch<unknown>(
      apiKey,
      "GET",
      `/organizations/${encodeURIComponent(organizationId)}/bank-accounts?limit=100&offset=0`,
    );
    const rec = asRecord(data);
    const list = Array.isArray(rec.bankAccounts)
      ? rec.bankAccounts
      : Array.isArray(rec.items)
        ? rec.items
        : Array.isArray(data)
          ? data
          : [];

    return list
      .map((item): ElbaBankAccount | null => {
        const b = asRecord(item);
        const id = asString(b.id);
        if (!id) return null;
        const bank = asRecord(b.bank);
        return {
          id,
          accountNumber: asString(b.accountNumber).replace(/\s+/g, ""),
          closed: Boolean(b.closed),
          bank: {
            name: asString(bank.name) || null,
            bik: asString(bank.bik) || null,
            corrAccount: asString(bank.corrAccount) || null,
            city: asString(bank.city) || null,
            cityType: asString(bank.cityType) || null,
          },
        };
      })
      .filter((x): x is ElbaBankAccount => x !== null);
  }

  async findOrCreateContractor(
    apiKey: string,
    organizationId: string,
    params: { name: string; inn?: string; address?: string },
  ): Promise<string | undefined> {
    const trimmedName = params.name.trim();
    if (!trimmedName) return undefined;

    const inn = (params.inn ?? "").replace(/\D+/g, "");

    // 1. Try searching existing contractor by INN or name
    try {
      const searchFilter: Record<string, unknown> =
        inn.length === 10 || inn.length === 12 ? { inn } : { name: trimmedName };
      const searchRes = await elbaFetch<unknown>(
        apiKey,
        "POST",
        `/organizations/${encodeURIComponent(organizationId)}/contractors/search`,
        { limit: 10, offset: 0, filter: searchFilter },
      );
      const rec = asRecord(searchRes);

      // Direct list response
      if (Array.isArray(rec.contractors) && rec.contractors.length > 0) {
        const first = asRecord(rec.contractors[0]);
        const id = asString(first.id);
        if (id) return id;
      }

      // Async long-running task response (poll up to 8 times)
      const taskId = asString(rec.taskId) || asString(rec.id);
      if (taskId) {
        for (let attempt = 0; attempt < 8; attempt += 1) {
          await new Promise((r) => setTimeout(r, 500));
          const taskState = asRecord(
            await elbaFetch<unknown>(
              apiKey,
              "GET",
              `/long-running-tasks/${encodeURIComponent(taskId)}`,
            ),
          );
          const status = asString(taskState.status).toLowerCase();
          if (status === "completed" || status === "succeeded" || status === "done") {
            const result = asRecord(taskState.result);
            if (Array.isArray(result.contractors) && result.contractors.length > 0) {
              const first = asRecord(result.contractors[0]);
              const id = asString(first.id);
              if (id) return id;
            }
            break;
          }
          if (status === "failed" || status === "error") break;
        }
      }
    } catch {
      // Search failure shouldn't block contractor creation
    }

    // 2. Create contractor
    const safeName = trimmedName.slice(0, 400);
    const createPayload: Record<string, unknown> = {
      name: safeName,
      shortName: safeName,
    };
    if (inn.length === 10 || inn.length === 12) {
      createPayload.inn = inn;
    }
    if (params.address && params.address.trim()) {
      createPayload.address = params.address.trim().slice(0, 2000);
    }

    const created = asRecord(
      await elbaFetch<unknown>(
        apiKey,
        "POST",
        `/organizations/${encodeURIComponent(organizationId)}/contractors`,
        createPayload,
      ),
    );
    return asString(created.id) || undefined;
  }

  async createBill(
    apiKey: string,
    organizationId: string,
    input: ElbaCreateBillInput,
  ): Promise<{ id: string }> {
    const body = buildCreateBillPayload(input);

    const res = asRecord(
      await elbaFetch<unknown>(
        apiKey,
        "POST",
        `/organizations/${encodeURIComponent(organizationId)}/bills`,
        body,
      ),
    );
    const id = asString(res.id);
    if (!id) {
      throw new AppError(502, "ELBA_INVALID_RESPONSE", "Контур.Эльба не вернула идентификатор счёта");
    }
    return { id };
  }
}

export const elbaClient = new ElbaClient();
