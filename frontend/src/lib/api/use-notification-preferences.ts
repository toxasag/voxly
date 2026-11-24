"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiClient } from "@/lib/api/apiClient";

export interface UserNotificationPreferencesDTO {
  notifications_enabled: boolean;
  sound_enabled: boolean;
  inapp_enabled: boolean;
  push_enabled: boolean;
  updated_at?: string;
}

export interface UpdateUserNotificationPreferencesPayload {
  notifications_enabled?: boolean;
  sound_enabled?: boolean;
  inapp_enabled?: boolean;
  push_enabled?: boolean;
}

export const NOTIFICATION_PREFERENCES_QUERY_KEY = ["notification-preferences"] as const;

export const DEFAULT_NOTIFICATION_PREFERENCES: UserNotificationPreferencesDTO = {
  notifications_enabled: true,
  sound_enabled: true,
  inapp_enabled: true,
  push_enabled: true,
};

export function useNotificationPreferences() {
  const queryClient = useQueryClient();

  const query = useQuery<UserNotificationPreferencesDTO>({
    queryKey: NOTIFICATION_PREFERENCES_QUERY_KEY,
    queryFn: async () => {
      try {
        const res = await apiClient.get<UserNotificationPreferencesDTO>(
          "/api/v1/settings/notifications/preferences",
        );
        return res.data ?? DEFAULT_NOTIFICATION_PREFERENCES;
      } catch (err) {
        console.warn("[NotificationPreferences] Falling back to defaults:", err);
        return DEFAULT_NOTIFICATION_PREFERENCES;
      }
    },
    staleTime: 60_000,
  });

  const updateMutation = useMutation({
    mutationFn: async (payload: UpdateUserNotificationPreferencesPayload) => {
      const res = await apiClient.patch<UserNotificationPreferencesDTO>(
        "/api/v1/settings/notifications/preferences",
        payload,
      );
      return res.data ?? DEFAULT_NOTIFICATION_PREFERENCES;
    },
    onMutate: async (newValues) => {
      await queryClient.cancelQueries({ queryKey: NOTIFICATION_PREFERENCES_QUERY_KEY });
      const previous =
        queryClient.getQueryData<UserNotificationPreferencesDTO>(
          NOTIFICATION_PREFERENCES_QUERY_KEY,
        ) ?? DEFAULT_NOTIFICATION_PREFERENCES;

      const optimistic: UserNotificationPreferencesDTO = {
        ...previous,
        ...newValues,
      };

      queryClient.setQueryData(NOTIFICATION_PREFERENCES_QUERY_KEY, optimistic);
      return { previous };
    },
    onError: (err, _newValues, context) => {
      if (context?.previous) {
        queryClient.setQueryData(NOTIFICATION_PREFERENCES_QUERY_KEY, context.previous);
      }
      toast.error("Не удалось сохранить настройки уведомлений");
      console.error("[NotificationPreferences] Update error:", err);
    },
    onSuccess: (data, variables) => {
      queryClient.setQueryData(NOTIFICATION_PREFERENCES_QUERY_KEY, data);
      if (variables.notifications_enabled !== undefined) {
        if (variables.notifications_enabled) {
          toast.success("Все уведомления включены");
        } else {
          toast.success("Все уведомления полностью отключены");
        }
      } else {
        toast.success("Настройки уведомлений сохранены");
      }
    },
  });

  return {
    preferences: query.data ?? DEFAULT_NOTIFICATION_PREFERENCES,
    isLoading: query.isLoading,
    isUpdating: updateMutation.isPending,
    updatePreferences: updateMutation.mutate,
    updatePreferencesAsync: updateMutation.mutateAsync,
  };
}
