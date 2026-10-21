"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Building2,
  Calendar,
  Check,
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  ChevronUp,
  CircleSlash,
  Clock,
  DollarSign,
  FileText,
  Home,
  Loader2,
  Mail,
  Monitor,
  Paperclip,
  Pencil,
  Plus,
  RotateCcw,
  User,
  UserCircle2,
} from "lucide-react";
import { Sheet, SheetHeader, SheetContent } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { TagPill } from "@/components/ui/tag";
import { EntityChip, chipInitials, paletteFor } from "@/components/crm/shared/EntityChip";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { DrawerCreateCompany } from "@/components/crm/deals/DrawerCreateCompany";
import { DrawerCreateContact } from "@/components/crm/deals/DrawerCreateContact";
import { stageTagColor } from "@/components/crm/deals/stage-colors";
import { usePipelines, useKanban } from "@/lib/api/use-deals";
import { useCompanies } from "@/lib/api/use-companies";
import { useContacts, contactFullName } from "@/lib/api/use-contacts";
import { useTenantUsers } from "@/lib/api/use-tenant-users";
import { useAuth } from "@/lib/auth/use-auth";
import { useOverlay } from "@/lib/utils/use-scroll-lock";
import { ApiClientError } from "@/lib/api/apiClient";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { CreateDealPayload } from "@/schemas/deal.schema";

export interface DrawerCreateDealProps {
  open: boolean;
  onClose: () => void;
  /** Rejects on failure so backend field errors can be shown in place. */
  onSubmit: (payload: CreateDealPayload) => Promise<unknown>;
  /** Preselects the pipeline the user is currently viewing. */
  defaultPipelineId?: string;
  defaultStageId?: string;
}

function FieldRow({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 px-4 py-1.5 min-h-[30px]">
      <span className="flex w-[120px] shrink-0 items-center gap-2 text-xs text-[#666666]">
        <Icon className="h-3.5 w-3.5 shrink-0 text-[#888888]" />
        <span className="truncate">{label}</span>
      </span>
      <span className="min-w-0 flex-1 text-[13px] text-[#111111]">{children}</span>
    </div>
  );
}

export function DrawerCreateDeal({
  open,
  onClose,
  onSubmit,
  defaultPipelineId,
  defaultStageId,
}: DrawerCreateDealProps) {
  useOverlay(open, { onEscape: onClose });

  const pipelines = usePipelines();
  const tenantUsers = useTenantUsers();
  const { user: authUser } = useAuth();

  const [title, setTitle] = useState("");
  const [budgetString, setBudgetString] = useState("");
  const [isEditingBudget, setIsEditingBudget] = useState(false);
  const [closeDate, setCloseDate] = useState("");
  const [isEditingCloseDate, setIsEditingCloseDate] = useState(false);

  const [pipelineId, setPipelineId] = useState<string>(defaultPipelineId ?? "");
  const [stageId, setStageId] = useState<string>(defaultStageId ?? "");

  const [companyId, setCompanyId] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState<string | null>(null);

  const [contactId, setContactId] = useState<string | null>(null);
  const [contactName, setContactName] = useState<string | null>(null);

  const [ownerId, setOwnerId] = useState<string | null>(null);

  const [dealOpen, setDealOpen] = useState(true);
  const [relationsOpen, setRelationsOpen] = useState(false);
  const [systemOpen, setSystemOpen] = useState(true);
  const [contactCardOpen, setContactCardOpen] = useState(true);
  const [companyCardOpen, setCompanyCardOpen] = useState(true);
  const [ownerCardOpen, setOwnerCardOpen] = useState(true);

  const [activePicker, setActivePicker] = useState<"stage" | "company" | "contact" | "owner" | null>(null);
  const [pickerAnchor, setPickerAnchor] = useState<"row" | "card">("row");
  const [pickerSearch, setPickerSearch] = useState("");

  const [isMaximized, setIsMaximized] = useState(false);
  const [activeTab, setActiveTab] = useState("home");
  const [moreTabsOpen, setMoreTabsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [cardView, setCardView] = useState<"deal" | "create_company" | "create_contact">("deal");

  // Kanban for selected pipeline (provides stages)
  const effectivePipelineId = pipelineId || defaultPipelineId || pipelines.data?.[0]?.id || null;
  const kanban = useKanban(effectivePipelineId);
  const companiesQuery = useCompanies({ limit: 100 });
  const contactsQuery = useContacts({ limit: 100 });

  // Current user resolution
  const currentUser = useMemo(() => {
    const list = tenantUsers.data ?? [];
    if (authUser?.id) {
      const found = list.find((u) => u.id === authUser.id);
      if (found) return found;
    }
    return list[0];
  }, [authUser?.id, tenantUsers.data]);

  // Reset form when drawer opens
  useEffect(() => {
    if (open) {
      setTitle("");
      setBudgetString("");
      setIsEditingBudget(false);
      setCloseDate("");
      setIsEditingCloseDate(false);
      setCompanyId(null);
      setCompanyName(null);
      setContactId(null);
      setContactName(null);
      setCardView("deal");
      setActiveTab("home");
      setActivePicker(null);
      setIsSubmitting(false);

      const resolvedPipeline = defaultPipelineId ?? pipelines.data?.[0]?.id ?? "";
      setPipelineId(resolvedPipeline);
      if (defaultStageId) {
        setStageId(defaultStageId);
      }
    }
  }, [open, defaultPipelineId, defaultStageId, pipelines.data]);

  // Set default owner to current user when users list loads
  useEffect(() => {
    if (open && currentUser && ownerId === null) {
      setOwnerId(currentUser.id);
    }
  }, [open, currentUser, ownerId]);

  // Auto-select first stage of the pipeline once kanban data is available
  const stagesList = useMemo(() => {
    return (kanban.data ?? []).map((col) => ({
      stageId: col.stageId,
      stageName: col.stageName,
      stageColor: col.stageColor,
      isWon: col.isWon,
      isLost: col.isLost,
      sortOrder: col.sortOrder,
    })).sort((a, b) => a.sortOrder - b.sortOrder);
  }, [kanban.data]);

  useEffect(() => {
    if (stagesList.length === 0) return;
    if (!stageId || !stagesList.some((s) => s.stageId === stageId)) {
      setStageId(stagesList[0].stageId);
    }
  }, [stagesList, stageId]);

  const selectedStage = useMemo(() => {
    return stagesList.find((s) => s.stageId === stageId) ?? stagesList[0];
  }, [stagesList, stageId]);

  const selectedOwner = useMemo(() => {
    if (!ownerId) return undefined;
    return (tenantUsers.data ?? []).find((u) => u.id === ownerId);
  }, [ownerId, tenantUsers.data]);

  const filteredStages = useMemo(() => {
    const q = pickerSearch.trim().toLowerCase();
    if (!q) return stagesList;
    return stagesList.filter((s) => s.stageName.toLowerCase().includes(q));
  }, [stagesList, pickerSearch]);

  const filteredCompanies = useMemo(() => {
    const items = companiesQuery.data?.items ?? [];
    const q = pickerSearch.trim().toLowerCase();
    if (!q) return items;
    return items.filter((c) => c.name.toLowerCase().includes(q));
  }, [companiesQuery.data?.items, pickerSearch]);

  const filteredContacts = useMemo(() => {
    const items = contactsQuery.data?.items ?? [];
    const q = pickerSearch.trim().toLowerCase();
    if (!q) return items;
    return items.filter((c) => contactFullName(c).toLowerCase().includes(q));
  }, [contactsQuery.data?.items, pickerSearch]);

  const filteredUsers = useMemo(() => {
    const items = tenantUsers.data ?? [];
    const q = pickerSearch.trim().toLowerCase();
    if (!q) return items;
    return items.filter((u) => u.fullName.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
  }, [tenantUsers.data, pickerSearch]);

  const openPicker = (type: "stage" | "company" | "contact" | "owner", anchor: "row" | "card") => {
    setActivePicker(type);
    setPickerAnchor(anchor);
    setPickerSearch("");
  };

  const handleSave = useCallback(async () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      toast.error("Укажите название сделки");
      return;
    }

    const resolvedPipeline = pipelineId || defaultPipelineId || pipelines.data?.[0]?.id;
    if (!resolvedPipeline) {
      toast.error("Не выбрана воронка");
      return;
    }

    const resolvedStage = stageId || stagesList[0]?.stageId;
    if (!resolvedStage) {
      toast.error("Не выбран этап воронки");
      return;
    }

    const numericBudget = budgetString.trim() ? Number(budgetString.replace(/\s+/g, "").replace(",", ".")) : 0;

    const payload: CreateDealPayload = {
      title: trimmedTitle,
      budget: Number.isNaN(numericBudget) || numericBudget < 0 ? 0 : numericBudget,
      currency: "RUB",
      pipeline_id: resolvedPipeline,
      stage_id: resolvedStage,
      company_id: companyId ?? undefined,
      contact_id: contactId ?? undefined,
      owner_id: ownerId ?? undefined,
      close_date: closeDate || undefined,
    };

    setIsSubmitting(true);
    try {
      await onSubmit(payload);
      onClose();
    } catch (error) {
      if (error instanceof ApiClientError && error.isValidationError) {
        const fields = error.fieldErrors();
        const firstError = Object.values(fields)[0] ?? error.message;
        toast.error(firstError);
      } else {
        toast.error(error instanceof Error ? error.message : "Не удалось создать сделку");
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [
    title,
    budgetString,
    pipelineId,
    defaultPipelineId,
    pipelines.data,
    stageId,
    stagesList,
    companyId,
    contactId,
    ownerId,
    closeDate,
    onSubmit,
    onClose,
  ]);

  if (!open) return null;

  const renderStagePicker = () => (
    <>
      <div className="fixed inset-0 z-30 cursor-default" onClick={() => setActivePicker(null)} />
      <div className="absolute left-0 top-full z-40 mt-1 w-56 rounded-[8px] border border-[#e5e5e5] bg-white p-1.5 shadow-xl">
        <div className="px-1.5 pb-1.5 border-b border-[#f0f0f0] mb-1">
          <input
            type="text"
            placeholder="Поиск"
            value={pickerSearch}
            onChange={(e) => setPickerSearch(e.target.value)}
            className="w-full text-xs text-[#111111] placeholder:text-[#999999] bg-transparent outline-none py-0.5"
            autoFocus
          />
        </div>
        <div className="max-h-56 overflow-y-auto space-y-0.5">
          {filteredStages.map((st) => {
            const isSelected = st.stageId === stageId;
            return (
              <button
                key={st.stageId}
                type="button"
                onClick={() => {
                  setStageId(st.stageId);
                  setActivePicker(null);
                }}
                className={cn(
                  "flex w-full items-center justify-between rounded-[6px] px-2 py-1.5 text-xs transition-colors hover:bg-[#f5f5f5] cursor-pointer",
                  isSelected && "bg-[#f5f5f5]",
                )}
              >
                <TagPill color={st.isWon ? "emerald" : st.isLost ? "rose" : stageTagColor(st.stageColor)}>
                  {st.stageName}
                </TagPill>
                {isSelected && <Check className="h-3.5 w-3.5 text-[#111111]" />}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );

  const renderCompanyPicker = () => (
    <>
      <div className="fixed inset-0 z-30 cursor-default" onClick={() => setActivePicker(null)} />
      <div className="absolute left-0 top-full z-40 mt-1 w-64 rounded-[8px] border border-[#e5e5e5] bg-white p-1.5 shadow-xl">
        <div className="px-2 py-1.5 border-b border-[#f0f0f0] mb-1">
          <input
            type="text"
            placeholder="Поиск"
            value={pickerSearch}
            onChange={(e) => setPickerSearch(e.target.value)}
            className="w-full text-xs text-[#111111] placeholder:text-[#888888] bg-transparent outline-none py-0.5"
            autoFocus
          />
        </div>
        <div className="max-h-56 overflow-y-auto space-y-0.5">
          <button
            type="button"
            onClick={() => {
              setCompanyId(null);
              setCompanyName(null);
              setActivePicker(null);
            }}
            className={cn(
              "flex w-full items-center justify-between rounded-[6px] px-2 py-1.5 text-xs text-[#111111] hover:bg-[#f5f5f5] transition-colors cursor-pointer",
              companyId === null && "bg-[#f5f5f5] font-medium",
            )}
          >
            <div className="flex items-center gap-2 truncate">
              <CircleSlash className="h-3.5 w-3.5 text-[#888888] shrink-0" />
              <span>Нет Компания</span>
            </div>
            {companyId === null && <Check className="h-3.5 w-3.5 text-[#111111] shrink-0" />}
          </button>
          {filteredCompanies.map((comp) => {
            const isSelected = comp.id === companyId;
            return (
              <button
                key={comp.id}
                type="button"
                onClick={() => {
                  setCompanyId(comp.id);
                  setCompanyName(comp.name);
                  setActivePicker(null);
                }}
                className={cn(
                  "flex w-full items-center justify-between rounded-[6px] px-2 py-1.5 text-xs text-[#111111] hover:bg-[#f5f5f5] transition-colors cursor-pointer",
                  isSelected && "bg-[#f5f5f5] font-medium",
                )}
              >
                <div className="flex items-center gap-2 truncate">
                  <span
                    className={cn(
                      "flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] border font-bold text-[9px]",
                      paletteFor(comp.name),
                    )}
                  >
                    {chipInitials(comp.name)}
                  </span>
                  <span className="truncate">{comp.name}</span>
                </div>
                {isSelected && <Check className="h-3.5 w-3.5 text-[#111111] shrink-0" />}
              </button>
            );
          })}
        </div>
        <div className="border-t border-[#f0f0f0] pt-1 mt-1">
          <button
            type="button"
            onClick={() => {
              setActivePicker(null);
              setCardView("create_company");
            }}
            className="flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-xs text-[#666666] hover:bg-[#f5f5f5] hover:text-[#111111] transition-colors cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5 shrink-0" />
            <span>Добавить новый</span>
          </button>
        </div>
      </div>
    </>
  );

  const renderContactPicker = () => (
    <>
      <div className="fixed inset-0 z-30 cursor-default" onClick={() => setActivePicker(null)} />
      <div className="absolute left-0 top-full z-40 mt-1 w-64 rounded-[8px] border border-[#e5e5e5] bg-white p-1.5 shadow-xl">
        <div className="px-2 py-1.5 border-b border-[#f0f0f0] mb-1">
          <input
            type="text"
            placeholder="Поиск"
            value={pickerSearch}
            onChange={(e) => setPickerSearch(e.target.value)}
            className="w-full text-xs text-[#111111] placeholder:text-[#888888] bg-transparent outline-none py-0.5"
            autoFocus
          />
        </div>
        <div className="max-h-56 overflow-y-auto space-y-0.5">
          <button
            type="button"
            onClick={() => {
              setContactId(null);
              setContactName(null);
              setActivePicker(null);
            }}
            className={cn(
              "flex w-full items-center justify-between rounded-[6px] px-2 py-1.5 text-xs text-[#111111] hover:bg-[#f5f5f5] transition-colors cursor-pointer",
              contactId === null && "bg-[#f5f5f5] font-medium",
            )}
          >
            <div className="flex items-center gap-2 truncate">
              <CircleSlash className="h-3.5 w-3.5 text-[#888888] shrink-0" />
              <span>Нет Контактное лицо</span>
            </div>
            {contactId === null && <Check className="h-3.5 w-3.5 text-[#111111] shrink-0" />}
          </button>
          {filteredContacts.map((contact) => {
            const isSelected = contact.id === contactId;
            const name = contactFullName(contact);
            return (
              <button
                key={contact.id}
                type="button"
                onClick={() => {
                  setContactId(contact.id);
                  setContactName(name);
                  setActivePicker(null);
                }}
                className={cn(
                  "flex w-full items-center justify-between rounded-[6px] px-2 py-1.5 text-xs text-[#111111] hover:bg-[#f5f5f5] transition-colors cursor-pointer",
                  isSelected && "bg-[#f5f5f5] font-medium",
                )}
              >
                <div className="flex items-center gap-2 truncate">
                  <span
                    className={cn(
                      "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border font-bold text-[9px]",
                      paletteFor(name),
                    )}
                  >
                    {chipInitials(name)}
                  </span>
                  <span className="truncate">{name}</span>
                </div>
                {isSelected && <Check className="h-3.5 w-3.5 text-[#111111] shrink-0" />}
              </button>
            );
          })}
        </div>
        <div className="border-t border-[#f0f0f0] pt-1 mt-1">
          <button
            type="button"
            onClick={() => {
              setActivePicker(null);
              setCardView("create_contact");
            }}
            className="flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-xs text-[#666666] hover:bg-[#f5f5f5] hover:text-[#111111] transition-colors cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5 shrink-0" />
            <span>Добавить новый</span>
          </button>
        </div>
      </div>
    </>
  );

  const renderOwnerPicker = () => (
    <>
      <div className="fixed inset-0 z-30 cursor-default" onClick={() => setActivePicker(null)} />
      <div className="absolute left-0 top-full z-40 mt-1 w-64 rounded-[8px] border border-[#e5e5e5] bg-white p-1.5 shadow-xl">
        <div className="px-2 py-1.5 border-b border-[#f0f0f0] mb-1">
          <input
            type="text"
            placeholder="Поиск"
            value={pickerSearch}
            onChange={(e) => setPickerSearch(e.target.value)}
            className="w-full text-xs text-[#111111] placeholder:text-[#888888] bg-transparent outline-none py-0.5"
            autoFocus
          />
        </div>
        <div className="max-h-56 overflow-y-auto space-y-0.5">
          <button
            type="button"
            onClick={() => {
              setOwnerId(null);
              setActivePicker(null);
            }}
            className={cn(
              "flex w-full items-center justify-between rounded-[6px] px-2 py-1.5 text-xs text-[#111111] hover:bg-[#f5f5f5] transition-colors cursor-pointer",
              ownerId === null && "bg-[#f5f5f5] font-medium",
            )}
          >
            <div className="flex items-center gap-2 truncate">
              <CircleSlash className="h-3.5 w-3.5 text-[#888888] shrink-0" />
              <span>Нет Владелец</span>
            </div>
            {ownerId === null && <Check className="h-3.5 w-3.5 text-[#111111] shrink-0" />}
          </button>
          {filteredUsers.map((user) => {
            const isSelected = user.id === ownerId;
            return (
              <button
                key={user.id}
                type="button"
                onClick={() => {
                  setOwnerId(user.id);
                  setActivePicker(null);
                }}
                className={cn(
                  "flex w-full items-center justify-between rounded-[6px] px-2 py-1.5 text-xs text-[#111111] hover:bg-[#f5f5f5] transition-colors cursor-pointer",
                  isSelected && "bg-[#f5f5f5] font-medium",
                )}
              >
                <div className="flex items-center gap-2 truncate">
                  <UserAvatar user={user} fallbackLabel="?" size="sm" />
                  <span className="truncate">{user.fullName}</span>
                </div>
                {isSelected && <Check className="h-3.5 w-3.5 text-[#111111] shrink-0" />}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );

  const displayBudget = budgetString.trim() ? Number(budgetString.replace(/\s+/g, "").replace(",", ".")) : 0;
  const systemUserName = currentUser?.fullName ?? authUser?.name ?? "Tvbox2026 оло";

  return (
    <Sheet open={open} onClose={onClose} width="w-[640px]" resizable isMaximized={isMaximized}>
      {cardView === "create_company" ? (
        <DrawerCreateCompany
          dealTitle={title}
          onBack={() => setCardView("deal")}
          onClose={onClose}
          onSuccess={(id, name) => {
            setCompanyId(id);
            setCompanyName(name);
            setCardView("deal");
          }}
        />
      ) : cardView === "create_contact" ? (
        <DrawerCreateContact
          dealTitle={title}
          onBack={() => setCardView("deal")}
          onClose={onClose}
          onSuccess={(id, name) => {
            setContactId(id);
            setContactName(name);
            setCardView("deal");
          }}
        />
      ) : (
        <>
          {/* Top Header matching Twenty CRM / Screenshot */}
          <SheetHeader
            onClose={onClose}
            onToggleMaximize={() => setIsMaximized((v) => !v)}
            isMaximized={isMaximized}
          >
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <span
                aria-hidden="true"
                className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] border text-[10px] font-bold shadow-2xs select-none",
                  title.trim() ? paletteFor(title.trim()) : "border-[#e5e5e5] bg-[#fafafa] text-[#888888]",
                )}
              >
                {title.trim() ? chipInitials(title.trim()) : "-"}
              </span>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Имя"
                autoFocus
                className="rounded-[4px] border border-[#3b82f6] px-2 py-0.5 text-xs font-semibold text-[#111111] outline-none bg-white min-w-0 w-48 focus:w-64 transition-all placeholder:text-[#888888]"
              />
            </div>
          </SheetHeader>

          {/* Sheet Body with Tabs */}
          <SheetContent className="flex flex-col h-full bg-white text-[#111111] p-0">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="flex h-full flex-col">
              {/* Tabs List */}
              <TabsList className="px-4 bg-white border-b border-[#e5e5e5] gap-1 shrink-0">
                <TabsTrigger
                  value="home"
                  className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium cursor-pointer"
                >
                  <Home className="h-3.5 w-3.5 shrink-0" />
                  <span>Главная</span>
                </TabsTrigger>
                <TabsTrigger
                  value="timeline"
                  className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium cursor-pointer"
                >
                  <Monitor className="h-3.5 w-3.5 shrink-0" />
                  <span>Временная шкала</span>
                </TabsTrigger>
                <TabsTrigger
                  value="tasks"
                  className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium cursor-pointer"
                >
                  <CheckSquare className="h-3.5 w-3.5 shrink-0" />
                  <span>Задачи</span>
                </TabsTrigger>
                <TabsTrigger
                  value="notes"
                  className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium cursor-pointer"
                >
                  <FileText className="h-3.5 w-3.5 shrink-0" />
                  <span>Заметки</span>
                </TabsTrigger>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setMoreTabsOpen((v) => !v)}
                    className="flex items-center gap-1 px-3 py-2 text-xs font-medium text-[#666666] hover:text-[#111111] transition-colors cursor-pointer"
                  >
                    <span>+3 Ещё</span>
                    <ChevronDown className="h-3 w-3 shrink-0" />
                  </button>
                  {moreTabsOpen && (
                    <>
                      <div className="fixed inset-0 z-30 cursor-default" onClick={() => setMoreTabsOpen(false)} />
                      <div className="absolute left-0 top-full z-40 mt-1 w-40 rounded-[8px] border border-[#e5e5e5] bg-white p-1 shadow-xl">
                        <button
                          type="button"
                          onClick={() => {
                            setActiveTab("files");
                            setMoreTabsOpen(false);
                          }}
                          className="flex w-full items-center gap-2 rounded-[6px] px-2.5 py-1.5 text-xs text-[#111111] hover:bg-[#f5f5f5] text-left cursor-pointer"
                        >
                          <Paperclip className="h-3.5 w-3.5 text-[#666666]" />
                          <span>Файлы</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setActiveTab("chat");
                            setMoreTabsOpen(false);
                          }}
                          className="flex w-full items-center gap-2 rounded-[6px] px-2.5 py-1.5 text-xs text-[#111111] hover:bg-[#f5f5f5] text-left cursor-pointer"
                        >
                          <Mail className="h-3.5 w-3.5 text-[#666666]" />
                          <span>Чат</span>
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </TabsList>

              {/* Main Tab Content */}
              <TabsContent value="home" className="mt-0 flex-1 overflow-y-auto py-2 text-[#111111]">
                <div className="px-4 pt-1 pb-2 text-xs font-semibold text-[#111111]">Поля</div>

                {/* Group 1: Сделка */}
                <div className="mt-1">
                  <button
                    type="button"
                    onClick={() => setDealOpen((prev) => !prev)}
                    className="flex w-full items-center justify-between px-4 py-1.5 text-xs font-medium text-[#666666] hover:text-[#111111] transition-colors cursor-pointer"
                  >
                    <span>Сделка</span>
                    <ChevronUp className={cn("h-3.5 w-3.5 text-[#888888] transition-transform", !dealOpen && "rotate-180")} />
                  </button>
                  {dealOpen && (
                    <div className="space-y-0.5 py-0.5">
                      {/* Сумма */}
                      <FieldRow icon={DollarSign} label="Сумма">
                        {isEditingBudget ? (
                          <div className="inline-flex items-center rounded-[6px] border border-[#3b82f6] bg-white shadow-xs overflow-hidden">
                            <div className="flex items-center gap-1 bg-[#fafafa] px-2 py-1 text-xs font-medium text-[#666666] border-r border-[#e5e5e5] select-none">
                              <span>RUB</span>
                            </div>
                            <div className="flex items-center px-2 py-1 gap-1">
                              <span className="text-xs text-[#888888]">₽</span>
                              <input
                                type="number"
                                min="0"
                                value={budgetString}
                                onChange={(e) => setBudgetString(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" || e.key === "Escape") {
                                    setIsEditingBudget(false);
                                  }
                                }}
                                onBlur={() => setIsEditingBudget(false)}
                                className="w-24 bg-transparent text-xs font-medium text-[#111111] outline-none tabular-nums"
                                autoFocus
                              />
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setIsEditingBudget(true)}
                            className="inline-flex items-center gap-1.5 rounded-[4px] px-1 py-0.5 -mx-1 text-left text-xs cursor-pointer hover:bg-[#f5f5f5] transition-colors"
                          >
                            {displayBudget > 0 ? (
                              <span className="text-[#111111] tabular-nums font-normal">
                                {new Intl.NumberFormat("ru-RU", {
                                  style: "currency",
                                  currency: "RUB",
                                  maximumFractionDigits: 0,
                                }).format(displayBudget)}
                              </span>
                            ) : (
                              <span className="text-[#888888]">Сумма</span>
                            )}
                            <Pencil className="h-3 w-3 text-[#999999] opacity-0 group-hover:opacity-100 transition-opacity" />
                          </button>
                        )}
                      </FieldRow>

                      {/* Этап */}
                      <FieldRow icon={Clock} label="Этап">
                        <div className="relative inline-block">
                          <button
                            type="button"
                            onClick={() => openPicker("stage", "row")}
                            className="cursor-pointer hover:opacity-85 transition-opacity inline-flex items-center"
                          >
                            {selectedStage ? (
                              <TagPill
                                color={
                                  selectedStage.isWon
                                    ? "emerald"
                                    : selectedStage.isLost
                                    ? "rose"
                                    : stageTagColor(selectedStage.stageColor)
                                }
                              >
                                {selectedStage.stageName}
                              </TagPill>
                            ) : (
                              <TagPill color="rose">New</TagPill>
                            )}
                          </button>
                          {activePicker === "stage" && pickerAnchor === "row" && renderStagePicker()}
                        </div>
                      </FieldRow>

                      {/* Дата Закрытия */}
                      <FieldRow icon={Calendar} label="Дата Закрытия">
                        {isEditingCloseDate ? (
                          <div className="inline-flex items-center gap-2">
                            <input
                              type="date"
                              value={closeDate}
                              onChange={(e) => {
                                setCloseDate(e.target.value);
                                setIsEditingCloseDate(false);
                              }}
                              onBlur={() => setIsEditingCloseDate(false)}
                              onKeyDown={(e) => {
                                if (e.key === "Escape") setIsEditingCloseDate(false);
                              }}
                              className="rounded-[6px] border border-[#3b82f6] px-2 py-0.5 text-xs text-[#111111] outline-none"
                              autoFocus
                            />
                            {closeDate && (
                              <button
                                type="button"
                                onClick={() => {
                                  setCloseDate("");
                                  setIsEditingCloseDate(false);
                                }}
                                className="text-[11px] text-[#888888] hover:text-rose-600 transition-colors"
                              >
                                ✕
                              </button>
                            )}
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setIsEditingCloseDate(true)}
                            className="inline-flex items-center gap-1.5 rounded-[4px] px-1 py-0.5 -mx-1 text-left text-xs cursor-pointer hover:bg-[#f5f5f5] transition-colors"
                          >
                            {closeDate ? (
                              <span className="text-[#111111]">
                                {new Intl.DateTimeFormat("ru-RU", {
                                  day: "2-digit",
                                  month: "long",
                                  year: "numeric",
                                }).format(new Date(closeDate))}
                              </span>
                            ) : (
                              <span className="text-[#888888]">Дата Закрытия</span>
                            )}
                            <Pencil className="h-3 w-3 text-[#999999] opacity-0 group-hover:opacity-100 transition-opacity" />
                          </button>
                        )}
                      </FieldRow>
                    </div>
                  )}
                </div>

                {/* Group 2: Связи */}
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={() => setRelationsOpen((prev) => !prev)}
                    className="flex w-full items-center justify-between px-4 py-1.5 text-xs font-medium text-[#666666] hover:text-[#111111] transition-colors cursor-pointer"
                  >
                    <span>Связи</span>
                    <ChevronUp className={cn("h-3.5 w-3.5 text-[#888888] transition-transform", !relationsOpen && "rotate-180")} />
                  </button>
                  {relationsOpen && (
                    <div className="space-y-0.5 py-0.5">
                      {/* Компания */}
                      <FieldRow icon={Building2} label="Компания">
                        <div className="relative inline-block">
                          {companyName ? (
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => openPicker("company", "row")}
                                className="cursor-pointer hover:opacity-85 transition-opacity"
                              >
                                <EntityChip name={companyName} label={companyName} icon={Building2} size="sm" />
                              </button>
                              <button
                                type="button"
                                onClick={() => openPicker("company", "row")}
                                className="flex h-5 w-5 items-center justify-center rounded-[4px] border border-[#e5e5e5] bg-white text-[#666666] hover:bg-[#f5f5f5] hover:text-[#111111] transition-colors cursor-pointer"
                              >
                                <Pencil className="h-3 w-3" />
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => openPicker("company", "row")}
                              className="text-xs text-[#888888] hover:text-[#111111] transition-colors cursor-pointer"
                            >
                              Компания
                            </button>
                          )}
                          {activePicker === "company" && pickerAnchor === "row" && renderCompanyPicker()}
                        </div>
                      </FieldRow>

                      {/* Контактное лицо */}
                      <FieldRow icon={User} label="Контактное л...">
                        <div className="relative inline-block">
                          {contactName ? (
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => openPicker("contact", "row")}
                                className="cursor-pointer hover:opacity-85 transition-opacity"
                              >
                                <EntityChip name={contactName} label={contactName} size="sm" />
                              </button>
                              <button
                                type="button"
                                onClick={() => openPicker("contact", "row")}
                                className="flex h-5 w-5 items-center justify-center rounded-[4px] border border-[#e5e5e5] bg-white text-[#666666] hover:bg-[#f5f5f5] hover:text-[#111111] transition-colors cursor-pointer"
                              >
                                <Pencil className="h-3 w-3" />
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => openPicker("contact", "row")}
                              className="text-xs text-[#888888] hover:text-[#111111] transition-colors cursor-pointer"
                            >
                              Контактное лицо
                            </button>
                          )}
                          {activePicker === "contact" && pickerAnchor === "row" && renderContactPicker()}
                        </div>
                      </FieldRow>

                      {/* Владелец */}
                      <FieldRow icon={UserCircle2} label="Владелец">
                        <div className="relative inline-block">
                          {selectedOwner ? (
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => openPicker("owner", "row")}
                                className="cursor-pointer hover:opacity-85 transition-opacity inline-flex items-center gap-1.5 text-xs text-[#111111]"
                              >
                                <UserAvatar user={selectedOwner} fallbackLabel="?" size="sm" />
                                <span>{selectedOwner.fullName}</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => openPicker("owner", "row")}
                                className="flex h-5 w-5 items-center justify-center rounded-[4px] border border-[#e5e5e5] bg-white text-[#666666] hover:bg-[#f5f5f5] hover:text-[#111111] transition-colors cursor-pointer"
                              >
                                <Pencil className="h-3 w-3" />
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => openPicker("owner", "row")}
                              className="text-xs text-[#888888] hover:text-[#111111] transition-colors cursor-pointer"
                            >
                              Владелец
                            </button>
                          )}
                          {activePicker === "owner" && pickerAnchor === "row" && renderOwnerPicker()}
                        </div>
                      </FieldRow>
                    </div>
                  )}
                </div>

                {/* Group 3: Система */}
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={() => setSystemOpen((prev) => !prev)}
                    className="flex w-full items-center justify-between px-4 py-1.5 text-xs font-medium text-[#666666] hover:text-[#111111] transition-colors cursor-pointer"
                  >
                    <span>Система</span>
                    <ChevronUp className={cn("h-3.5 w-3.5 text-[#888888] transition-transform", !systemOpen && "rotate-180")} />
                  </button>
                  {systemOpen && (
                    <div className="space-y-0.5 py-0.5">
                      <FieldRow icon={Calendar} label="Дата создания">
                        <span className="text-[#111111] text-xs">меньше минуты назад</span>
                      </FieldRow>
                      <FieldRow icon={RotateCcw} label="Создано">
                        <span className="inline-flex items-center gap-1.5 text-xs text-[#111111]">
                          <span
                            className={cn(
                              "flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold border",
                              paletteFor(systemUserName),
                            )}
                          >
                            {chipInitials(systemUserName)}
                          </span>
                          <span>{systemUserName}</span>
                        </span>
                      </FieldRow>
                    </div>
                  )}
                </div>

                {/* Lower Separate Relation Cards with Pencil Edit Icon */}
                <div className="relative mt-4 border-t border-[#f0f0f0] pt-3 px-4">
                  <div className="flex items-center justify-between mb-1">
                    <button
                      type="button"
                      title="Свернуть / развернуть блок «Контактное лицо»"
                      onClick={() => setContactCardOpen((prev) => !prev)}
                      className="flex items-center gap-1.5 text-xs font-medium text-[#111111] hover:text-[#4a38f5] transition-colors cursor-pointer"
                    >
                      <span>Контактное лицо</span>
                      <ChevronUp className={cn("h-3.5 w-3.5 text-[#888888] transition-transform", !contactCardOpen && "rotate-180")} />
                    </button>
                    <button
                      type="button"
                      title="Редактировать контактное лицо"
                      aria-label="Редактировать контактное лицо"
                      onClick={() => openPicker("contact", "card")}
                      className="rounded-[4px] p-1 text-[#888888] hover:bg-black/[0.04] hover:text-[#111111] transition-colors cursor-pointer"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  {contactCardOpen && (
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => openPicker("contact", "card")}
                        className="text-left cursor-pointer hover:opacity-85 transition-opacity"
                      >
                        {contactName ? (
                          <EntityChip name={contactName} label={contactName} size="sm" />
                        ) : (
                          <span className="inline-flex h-5 items-center justify-center rounded-[4px] bg-[#f5f5f5] px-2 text-xs font-normal text-[#888888] select-none">-</span>
                        )}
                      </button>
                      {activePicker === "contact" && pickerAnchor === "card" && renderContactPicker()}
                    </div>
                  )}
                </div>

                <div className="relative mt-4 border-t border-[#f0f0f0] pt-3 px-4">
                  <div className="flex items-center justify-between mb-1">
                    <button
                      type="button"
                      title="Свернуть / развернуть блок «Компания»"
                      onClick={() => setCompanyCardOpen((prev) => !prev)}
                      className="flex items-center gap-1.5 text-xs font-medium text-[#111111] hover:text-[#4a38f5] transition-colors cursor-pointer"
                    >
                      <span>Компания</span>
                      <ChevronUp className={cn("h-3.5 w-3.5 text-[#888888] transition-transform", !companyCardOpen && "rotate-180")} />
                    </button>
                    <button
                      type="button"
                      title="Редактировать компанию"
                      aria-label="Редактировать компанию"
                      onClick={() => openPicker("company", "card")}
                      className="rounded-[4px] p-1 text-[#888888] hover:bg-black/[0.04] hover:text-[#111111] transition-colors cursor-pointer"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  {companyCardOpen && (
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => openPicker("company", "card")}
                        className="text-left cursor-pointer hover:opacity-85 transition-opacity"
                      >
                        {companyName ? (
                          <EntityChip name={companyName} label={companyName} icon={Building2} size="sm" />
                        ) : (
                          <span className="inline-flex h-5 items-center justify-center rounded-[4px] bg-[#f5f5f5] px-2 text-xs font-normal text-[#888888] select-none">-</span>
                        )}
                      </button>
                      {activePicker === "company" && pickerAnchor === "card" && renderCompanyPicker()}
                    </div>
                  )}
                </div>

                <div className="relative mt-4 border-t border-[#f0f0f0] pt-3 px-4 pb-4">
                  <div className="flex items-center justify-between mb-1">
                    <button
                      type="button"
                      title="Свернуть / развернуть блок «Владелец»"
                      onClick={() => setOwnerCardOpen((prev) => !prev)}
                      className="flex items-center gap-1.5 text-xs font-medium text-[#111111] hover:text-[#4a38f5] transition-colors cursor-pointer"
                    >
                      <span>Владелец</span>
                      <ChevronUp className={cn("h-3.5 w-3.5 text-[#888888] transition-transform", !ownerCardOpen && "rotate-180")} />
                    </button>
                    <button
                      type="button"
                      title="Редактировать ответственного"
                      aria-label="Редактировать ответственного"
                      onClick={() => openPicker("owner", "card")}
                      className="rounded-[4px] p-1 text-[#888888] hover:bg-black/[0.04] hover:text-[#111111] transition-colors cursor-pointer"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  {ownerCardOpen && (
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => openPicker("owner", "card")}
                        className="text-left cursor-pointer hover:opacity-85 transition-opacity"
                      >
                        {selectedOwner ? (
                          <span className="inline-flex items-center gap-1.5 text-xs text-[#111111]">
                            <UserAvatar user={selectedOwner} fallbackLabel="?" size="sm" />
                            <span>{selectedOwner.fullName}</span>
                          </span>
                        ) : (
                          <span className="inline-flex h-5 items-center justify-center rounded-[4px] bg-[#f5f5f5] px-2 text-xs font-normal text-[#888888] select-none">-</span>
                        )}
                      </button>
                      {activePicker === "owner" && pickerAnchor === "card" && renderOwnerPicker()}
                    </div>
                  )}
                </div>
              </TabsContent>

              {/* Other Tabs: show informative message before deal is created */}
              <TabsContent value="timeline" className="mt-0 flex-1 p-6 text-center text-xs text-[#666666]">
                Временная шкала появится после создания сделки.
              </TabsContent>
              <TabsContent value="tasks" className="mt-0 flex-1 p-6 text-center text-xs text-[#666666]">
                Задачи можно будет привязывать после создания сделки.
              </TabsContent>
              <TabsContent value="notes" className="mt-0 flex-1 p-6 text-center text-xs text-[#666666]">
                Заметки можно будет вести после создания сделки.
              </TabsContent>
              <TabsContent value="files" className="mt-0 flex-1 p-6 text-center text-xs text-[#666666]">
                Файлы можно будет прикреплять после создания сделки.
              </TabsContent>
              <TabsContent value="chat" className="mt-0 flex-1 p-6 text-center text-xs text-[#666666]">
                Чат станет доступен после создания сделки.
              </TabsContent>
            </Tabs>
          </SheetContent>

          {/* Sticky Bottom Actions Bar */}
          <div className="sticky bottom-0 z-20 flex items-center justify-between border-t border-[#e5e5e5] bg-white px-4 py-2.5 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="h-8 rounded-[8px] border border-[#e5e5e5] px-4 text-xs font-medium text-[#666666] hover:bg-[#fafafa] hover:text-[#111111] transition-colors cursor-pointer"
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isSubmitting || !title.trim()}
              className="flex h-8 items-center gap-2 rounded-[8px] bg-[#4a38f5] px-4 text-xs font-medium text-white hover:bg-[#3d2ee0] transition-colors cursor-pointer disabled:opacity-50"
            >
              {isSubmitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              <span>Создать сделку</span>
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}
