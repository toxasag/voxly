import { z } from "zod";
const digits=(lengths:number[],label:string)=>z.string().refine(v=>v===""||(/^\d+$/.test(v)&&lengths.includes(v.length)),`${label} must contain ${lengths.join(" or ")} digits`);
const optionalUuid=z.union([z.string().uuid("Select a valid manager"),z.literal("")]).optional();
export const createCompanySchema=z.object({
  name:z.string().min(1,"Company name is required").max(200),
  domain_name:z.string().max(200).optional().or(z.literal("")),
  phone:z.string().max(30).optional().or(z.literal("")),
  email:z.string().email("Invalid email").optional().or(z.literal("")),
  inn:digits([10,12],"INN").optional(),
  ogrn:digits([13,15],"OGRN").optional(),
  bik:digits([9],"BIK").optional(),
  account_number:digits([20],"Account number").optional(),
  legal_address:z.string().max(300).optional().or(z.literal("")),
  manager_name:z.string().max(100).optional().or(z.literal("")),
  manager_id:optionalUuid,
  // Twenty: company.annualRevenue (группа business), company.linkedinLink и
  // company.address (группа contact).
  annual_revenue:z.number().min(0,"Revenue cannot be negative").nullable().optional(),
  linkedin_link:z.string().url("Invalid URL").max(300).optional().or(z.literal("")),
  address_city:z.string().max(120).optional().or(z.literal("")),
  address_street:z.string().max(200).optional().or(z.literal("")),
  address_country:z.string().max(120).optional().or(z.literal("")),
  address_postcode:z.string().max(20).optional().or(z.literal("")),
  notes:z.string().max(4000).optional().or(z.literal("")),
  custom_fields:z.record(z.string()).optional(),
});
export const updateCompanySchema=createCompanySchema.partial();
export type CreateCompanyPayload=z.infer<typeof createCompanySchema>;export type UpdateCompanyPayload=z.infer<typeof updateCompanySchema>;
