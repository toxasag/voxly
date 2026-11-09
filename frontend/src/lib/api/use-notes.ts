"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { apiClient, type ApiClientError, type ApiMeta } from "@/lib/api/apiClient";

// ---------------------------------------------------------------------------
// Заметки записи. Образец — объект Note в Twenty: заметка привязана к записи
// (у них через junction NoteTarget), у неё необязательный заголовок и текст.
// ---------------------------------------------------------------------------

export type NoteTargetType = "contact" | "company" | "deal";

export interface NoteDTO {
  id: string;
  title: string;
  body: string;
  targetType: NoteTargetType;
  targetId: string;
  repairOrderId?: string | null;
  repairTicketNumber?: string | null;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateNotePayload {
  title?: string;
  body: string;
  target_type: NoteTargetType;
  target_id: string;
  repair_order_id?: string;
}

export interface UpdateNotePayload {
  title?: string;
  body?: string;
}

export interface NotesListResult {
  items: NoteDTO[];
  total: number;
}

const BASE = "/api/v1/crm/notes";

export const noteKeys = {
  all: ["notes"] as const,
  list: (type: NoteTargetType, id: string) => ["notes", "list", type, id] as const,
};

export function useNotes(
  targetType: NoteTargetType,
  targetId: string | null,
): UseQueryResult<NotesListResult, ApiClientError> {
  return useQuery<NotesListResult, ApiClientError>({
    queryKey: noteKeys.list(targetType, targetId ?? ""),
    queryFn: async () => {
      const response = await apiClient.get<NoteDTO[]>(BASE, {
        query: { target_type: targetType, target_id: targetId, limit: 50 },
      });
      const meta: ApiMeta = response.meta ?? {};

      return {
        items: response.data,
        total: typeof meta.total === "number" ? meta.total : response.data.length,
      };
    },
    enabled: targetId !== null && targetId.length > 0,
  });
}

export function useCreateNote(): UseMutationResult<NoteDTO, ApiClientError, CreateNotePayload> {
  const queryClient = useQueryClient();

  return useMutation<NoteDTO, ApiClientError, CreateNotePayload>({
    mutationFn: async (payload) => (await apiClient.post<NoteDTO>(BASE, payload)).data,
    onSuccess: (note) => {
      void queryClient.invalidateQueries({ queryKey: noteKeys.list(note.targetType, note.targetId) });
    },
  });
}

export function useUpdateNote(): UseMutationResult<
  NoteDTO,
  ApiClientError,
  { id: string; payload: UpdateNotePayload }
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, payload }) => (await apiClient.patch<NoteDTO>(`${BASE}/${id}`, payload)).data,
    onSuccess: (note) => {
      void queryClient.invalidateQueries({ queryKey: noteKeys.list(note.targetType, note.targetId) });
    },
  });
}

export function useDeleteNote(): UseMutationResult<
  null,
  ApiClientError,
  { id: string; targetType: NoteTargetType; targetId: string }
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id }) => {
      await apiClient.delete<null>(`${BASE}/${id}`);
      return null;
    },
    // Инвалидация по цели, а не по всему семейству: удаление заметки не влияет
    // на списки заметок других записей.
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: noteKeys.list(variables.targetType, variables.targetId),
      });
    },
  });
}
