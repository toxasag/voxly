"use client";

import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from "@tanstack/react-query";
import { apiClient, type ApiClientError, type ApiMeta } from "@/lib/api/apiClient";
import type { CreateCompanyPayload, UpdateCompanyPayload } from "@/schemas/company.schema";

/** Twenty: company.address (AddressMetadata) — используемые подполя. */
export interface CompanyAddressDTO { city: string; street: string; country: string; postcode: string; }

export interface CompanyDTO {
  id: string;
  name: string;
  domainName: string;
  phone: string;
  email: string;
  requisites: { inn: string; ogrn: string; bik: string; accountNumber: string; legalAddress: string };
  managerName: string;
  managerId: string | null;
  /** Twenty: company.annualRevenue. null — доход неизвестен, это не 0. */
  annualRevenue: number | null;
  linkedinLink: string;
  address: CompanyAddressDTO;
  notes: string;
  customFields: Record<string, unknown>;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
  contactsCount: number;
  dealsCount: number;
  dealsBudgetTotal: number;
}
export interface CompanyStatsDTO { contactsCount:number; dealsCount:number; dealsBudgetTotal:number; }
export interface CompaniesQueryParams { search?:string; managerId?:string; limit?:number; offset?:number; }
export interface CompaniesListResult { items:CompanyDTO[]; total:number; limit:number; offset:number; }
const BASE="/api/v1/crm/companies";
export const companyKeys={all:["companies"] as const,list:(p:CompaniesQueryParams)=>["companies","list",p] as const,detail:(id:string)=>["companies","detail",id] as const,stats:(id:string)=>["companies","stats",id] as const};
export function useCompanies(p:CompaniesQueryParams={}):UseQueryResult<CompaniesListResult,ApiClientError>{const limit=p.limit??25,offset=p.offset??0;return useQuery({queryKey:companyKeys.list({...p,limit,offset}),queryFn:async()=>{const r=await apiClient.get<CompanyDTO[]>(BASE,{query:{search:p.search,manager_id:p.managerId,limit,offset}});const m:ApiMeta=r.meta??{};return{items:r.data,total:typeof m.total==="number"?m.total:r.data.length,limit:typeof m.limit==="number"?m.limit:limit,offset:typeof m.offset==="number"?m.offset:offset};},placeholderData:(x)=>x});}
/**
 * Одна компания по идентификатору.
 *
 * Нужна для перехода с карточки контакта: компания может не оказаться на текущей
 * странице списка, и брать её из кэша списка (как это делает страница компаний)
 * там нельзя.
 */
export function useCompany(id:string|null):UseQueryResult<CompanyDTO,ApiClientError>{return useQuery({queryKey:companyKeys.detail(id??""),queryFn:async()=>(await apiClient.get<CompanyDTO>(`${BASE}/${id??""}`)).data,enabled:id!==null&&id.length>0});}
export function useCompanyStats(id:string|null):UseQueryResult<CompanyStatsDTO,ApiClientError>{return useQuery({queryKey:companyKeys.stats(id??""),queryFn:async()=> (await apiClient.get<CompanyStatsDTO>(`${BASE}/${id??""}/stats`)).data,enabled:id!==null&&id.length>0});}
export function useCreateCompany():UseMutationResult<CompanyDTO,ApiClientError,CreateCompanyPayload>{const q=useQueryClient();return useMutation({mutationFn:async p=>(await apiClient.post<CompanyDTO>(BASE,p)).data,onSuccess:()=>void q.invalidateQueries({queryKey:companyKeys.all})});}
export function useUpdateCompany():UseMutationResult<CompanyDTO,ApiClientError,{id:string;payload:UpdateCompanyPayload}>{const q=useQueryClient();return useMutation({mutationFn:async({id,payload})=>(await apiClient.patch<CompanyDTO>(`${BASE}/${id}`,payload)).data,onSuccess:(x)=>{q.setQueryData(companyKeys.detail(x.id),x);void q.invalidateQueries({queryKey:companyKeys.all});}});}
export function useDeleteCompany():UseMutationResult<null,ApiClientError,string>{
  const qc=useQueryClient();
  return useMutation({mutationFn:async(id)=>{await apiClient.delete<null>(`${BASE}/${id}`);return null;},onSuccess:(_,id)=>{qc.removeQueries({queryKey:companyKeys.detail(id)});void qc.invalidateQueries({queryKey:companyKeys.all});}});
}

export function toCompanyFormValues(x:CompanyDTO):CreateCompanyPayload{
  return {
    name: x.name,
    // domain_name отсутствовал: форма правки открывалась с пустым доменом и
    // PATCH затирал его при каждом сохранении.
    domain_name: x.domainName,
    phone: x.phone,
    email: x.email,
    inn: x.requisites.inn,
    ogrn: x.requisites.ogrn,
    bik: x.requisites.bik,
    account_number: x.requisites.accountNumber,
    legal_address: x.requisites.legalAddress,
    manager_name: x.managerName,
    manager_id: x.managerId ?? "",
    annual_revenue: x.annualRevenue,
    linkedin_link: x.linkedinLink,
    address_city: x.address.city,
    address_street: x.address.street,
    address_country: x.address.country,
    address_postcode: x.address.postcode,
    notes: x.notes,
    custom_fields: Object.fromEntries(Object.entries(x.customFields).map(([k,v])=>[k,String(v)])),
  };
}
