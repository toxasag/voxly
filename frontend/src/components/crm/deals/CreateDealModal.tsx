"use client";

import { useCallback, useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { X, Handshake, Banknote, User, Building2, Loader2, AlertCircle } from "lucide-react";
import { createDealSchema, type CreateDealPayload } from "@/schemas/deal.schema";
import { ApiClientError } from "@/lib/api/apiClient";
import { usePipelines, useKanban } from "@/lib/api/use-deals";
import { useContacts } from "@/lib/api/use-contacts";
import { useCompanies } from "@/lib/api/use-companies";
import { cn } from "@/lib/utils";
import { useOverlay } from "@/lib/utils/use-scroll-lock";

interface CreateDealModalProps {
  open: boolean;
  onClose: () => void;
  /** Rejects on failure so backend field errors can be shown in place. */
  onSubmit: (payload: CreateDealPayload) => Promise<unknown>;
  /** Preselects the board the user is currently viewing. */
  defaultPipelineId?: string;
}

const FIELDS = new Set<keyof CreateDealPayload>(["title", "description", "budget", "currency", "pipeline_id", "stage_id", "contact_id", "company_id"]);

function message(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "message" in error && typeof error.message === "string" ? error.message : undefined;
}

export function CreateDealModal({ open, onClose, onSubmit, defaultPipelineId }: CreateDealModalProps) {
  const pipelines = usePipelines();
  const contacts = useContacts({ limit: 100 });
  const companies = useCompanies({ limit: 100 });

  const form = useForm<CreateDealPayload>({
    resolver: zodResolver(createDealSchema),
    defaultValues: { title: "", description: "", budget: 0, currency: "RUB", pipeline_id: "", stage_id: "", contact_id: "", company_id: "" },
    mode: "onChange",
  });

  const pipelineId = form.watch("pipeline_id");
  // Stages come from the Kanban projection of the chosen pipeline — the only
  // endpoint that returns stage ids, so a deal can never target a foreign stage.
  const kanban = useKanban(pipelineId.length > 0 ? pipelineId : null);

  // Единый стек оверлеев. Закрывает два дефекта разом: прямая правка
  // `body.style.overflow` возвращала прокрутку фону при закрытии верхнего из
  // нескольких оверлеев, а собственный слушатель Escape закрывал их все сразу.
  useOverlay(open, { onEscape: onClose });

  // Default the pipeline to the current board once the catalog resolves.
  useEffect(() => {
    if (!open) return;
    if (form.getValues("pipeline_id").length > 0) return;
    const preset = defaultPipelineId ?? pipelines.data?.[0]?.id;
    if (preset !== undefined) form.setValue("pipeline_id", preset, { shouldValidate: true });
  }, [open, defaultPipelineId, pipelines.data, form]);

  // Auto-select the first stage of the pipeline; changing pipeline resets it.
  const stages = useMemo(() => [...(kanban.data ?? [])].sort((a, b) => a.sortOrder - b.sortOrder), [kanban.data]);
  useEffect(() => {
    if (stages.length === 0) return;
    const current = form.getValues("stage_id");
    if (!stages.some((stage) => stage.stageId === current)) {
      form.setValue("stage_id", stages[0]?.stageId ?? "", { shouldValidate: true });
    }
  }, [stages, form]);

  useEffect(() => {
    if (open) form.reset({ title: "", description: "", budget: 0, currency: "RUB", pipeline_id: defaultPipelineId ?? "", stage_id: "", contact_id: "", company_id: "" });
  }, [open, defaultPipelineId, form]);


  const submit = useCallback(async (values: CreateDealPayload) => {
    try {
      await onSubmit(values);
      form.reset();
      onClose();
    } catch (error) {
      if (error instanceof ApiClientError && error.isValidationError) {
        const fields = error.fieldErrors();
        let matched = false;
        for (const [field, text] of Object.entries(fields)) {
          if (FIELDS.has(field as keyof CreateDealPayload)) { form.setError(field as keyof CreateDealPayload, { type: "server", message: text }); matched = true; }
        }
        if (!matched) form.setError("root", { type: "server", message: fields._root ?? error.message });
        return;
      }
      form.setError("root", { type: "server", message: error instanceof Error ? error.message : "Could not create the deal" });
    }
  }, [onSubmit, form, onClose]);

  if (!open) return null;
  const { errors, isValid, isSubmitting } = form.formState;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-800 bg-slate-900 shadow-2xl">
        <div className="sticky top-0 flex items-center justify-between border-b border-slate-800 bg-slate-900 px-6 py-4">
          <div className="flex items-center gap-2.5"><div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/10"><Handshake className="h-4 w-4 text-amber-400" /></div><div><h2 className="text-sm font-semibold text-slate-100">Новая сделка</h2><p className="text-xs text-slate-500">Добавьте сделку на стадию воронки</p></div></div>
          <button type="button" onClick={onClose} aria-label="Закрыть" className="p-1.5 text-slate-500 hover:text-slate-300"><X className="h-4 w-4" /></button>
        </div>

        <form onSubmit={form.handleSubmit(submit)} className="space-y-4 p-6">
          {message(errors.root) && <div role="alert" className="flex gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300"><AlertCircle className="h-4 w-4 shrink-0" />{message(errors.root)}</div>}

          <div className="space-y-2">
            <label htmlFor="deal-title" className="block text-xs font-medium text-slate-400">Название сделки *</label>
            <input id="deal-title" autoFocus placeholder="Внедрение CRM" {...form.register("title")} className={cn("w-full rounded-lg border bg-slate-950 px-3.5 py-2.5 text-sm text-slate-100 focus:border-amber-500 focus:outline-none", errors.title ? "border-rose-500" : "border-slate-700")} />
            {message(errors.title) && <p className="text-xs text-rose-400">{message(errors.title)}</p>}
          </div>

          <div className="space-y-2">
            <label htmlFor="deal-budget" className="block text-xs font-medium text-slate-400">Сумма</label>
            <div className="relative"><Banknote className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" /><input id="deal-budget" type="number" min={0} placeholder="450000" {...form.register("budget", { valueAsNumber: true })} className={cn("w-full rounded-lg border bg-slate-950 py-2.5 pl-10 pr-4 text-sm text-slate-100 focus:border-amber-500 focus:outline-none [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none", errors.budget ? "border-rose-500" : "border-slate-700")} /></div>
            {message(errors.budget) && <p className="text-xs text-rose-400">{message(errors.budget)}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label htmlFor="deal-pipeline" className="block text-xs font-medium text-slate-400">Воронка *</label>
              <select id="deal-pipeline" {...form.register("pipeline_id")} disabled={pipelines.isLoading} className={cn("w-full rounded-lg border bg-slate-950 px-3.5 py-2.5 text-sm text-slate-100 focus:border-amber-500 focus:outline-none", errors.pipeline_id ? "border-rose-500" : "border-slate-700")}>
                <option value="" disabled>{pipelines.isLoading ? "Loading…" : "Select pipeline"}</option>
                {pipelines.data?.map((pipeline) => <option key={pipeline.id} value={pipeline.id}>{pipeline.name}</option>)}
              </select>
              {message(errors.pipeline_id) && <p className="text-xs text-rose-400">{message(errors.pipeline_id)}</p>}
            </div>
            <div className="space-y-2">
              <label htmlFor="deal-stage" className="block text-xs font-medium text-slate-400">Стадия *</label>
              <select id="deal-stage" {...form.register("stage_id")} disabled={pipelineId.length === 0 || kanban.isLoading} className={cn("w-full rounded-lg border bg-slate-950 px-3.5 py-2.5 text-sm text-slate-100 focus:border-amber-500 focus:outline-none disabled:opacity-50", errors.stage_id ? "border-rose-500" : "border-slate-700")}>
                <option value="" disabled>{kanban.isLoading ? "Loading…" : "Select stage"}</option>
                {stages.map((stage) => <option key={stage.stageId} value={stage.stageId}>{stage.stageName}</option>)}
              </select>
              {message(errors.stage_id) && <p className="text-xs text-rose-400">{message(errors.stage_id)}</p>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label htmlFor="deal-contact" className="block text-xs font-medium text-slate-400">Контакт</label>
              <div className="relative"><User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" /><select id="deal-contact" {...form.register("contact_id")} className="w-full rounded-lg border border-slate-700 bg-slate-950 py-2.5 pl-10 pr-4 text-sm text-slate-100 focus:border-amber-500 focus:outline-none"><option value="">Без контакта</option>{contacts.data?.items.map((contact) => <option key={contact.id} value={contact.id}>{contact.firstName} {contact.lastName}</option>)}</select></div>
            </div>
            <div className="space-y-2">
              <label htmlFor="deal-company" className="block text-xs font-medium text-slate-400">Компания</label>
              <div className="relative"><Building2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" /><select id="deal-company" {...form.register("company_id")} className="w-full rounded-lg border border-slate-700 bg-slate-950 py-2.5 pl-10 pr-4 text-sm text-slate-100 focus:border-amber-500 focus:outline-none"><option value="">Без компании</option>{companies.data?.items.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></div>
            </div>
          </div>

          <div className="flex justify-end gap-3 border-t border-slate-800 pt-3">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200">Отмена</button>
            <button type="submit" disabled={!isValid || isSubmitting} className="flex items-center gap-2 rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50">{isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}Create Deal</button>
          </div>
        </form>
      </div>
    </div>
  );
}
