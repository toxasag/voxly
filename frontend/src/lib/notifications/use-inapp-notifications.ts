"use client";

import { useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiClient } from "@/lib/api/apiClient";
import { useNotificationPreferences } from "@/lib/api/use-notification-preferences";
import type { AppNotification, NotificationCategory } from "@/types";

export const INAPP_NOTIFICATIONS_QUERY_KEY = ["inapp-notifications"] as const;

interface NotificationsResponse {
  data: AppNotification[];
  meta: {
    unreadCount: number;
  };
}

export interface MarkEntityReadParams {
  entity_type: AppNotification["entity_type"];
  entity_id: string;
  categories?: NotificationCategory[];
}

function matchesEntityTarget(n: AppNotification, params: MarkEntityReadParams): boolean {
  if (n.entity_id !== params.entity_id) return false;
  const sameGroup =
    params.entity_type === "deal" || params.entity_type === "chat" || params.entity_type === "lead"
      ? n.entity_type === "deal" || n.entity_type === "chat" || n.entity_type === "lead"
      : n.entity_type === params.entity_type;
  if (!sameGroup) return false;
  if (params.categories && params.categories.length > 0) {
    return params.categories.includes(n.category);
  }
  return true;
}

/**
 * Лёгкий хук без SSE-подключения: помечает прочитанными все уведомления
 * по сущности (сделка, контакт, чат, задача, наряд) и синхронизирует кеш колокольчика.
 */
export function useMarkEntityNotificationsRead() {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (params: MarkEntityReadParams) => {
      await apiClient.post("/api/v1/notifications/read-by-entity", params);
    },
    onMutate: (params) => {
      queryClient.setQueryData<NotificationsResponse>(INAPP_NOTIFICATIONS_QUERY_KEY, (old) => {
        if (!old) return old;
        let removedCount = 0;
        const remaining = old.data.filter((n) => {
          const hit = matchesEntityTarget(n, params);
          if (hit && !n.read) removedCount += 1;
          return !hit;
        });
        if (removedCount === 0 && remaining.length === old.data.length) return old;
        return {
          data: remaining,
          meta: {
            unreadCount: Math.max(0, old.meta.unreadCount - removedCount),
          },
        };
      });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: INAPP_NOTIFICATIONS_QUERY_KEY });
    },
  });

  const markEntityRead = useCallback(
    (params: MarkEntityReadParams) => {
      if (!params.entity_id) return;
      mutation.mutate(params);
    },
    [mutation],
  );

  return { markEntityRead, isPending: mutation.isPending };
}

function playNotificationChime() {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    if (ctx.state === "suspended") {
      void ctx.resume();
    }

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    // Благозвучный двухтоновый перелив (D5 -> A5)
    osc.frequency.setValueAtTime(587.33, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.12);

    gain.gain.setValueAtTime(0.06, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.35);
  } catch {
    // Безопасный перехват, если браузер блокирует автоплей до первого клика
  }
}

export function useInAppNotifications() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { preferences } = useNotificationPreferences();

  const preferencesRef = useRef(preferences);
  useEffect(() => {
    preferencesRef.current = preferences;
  }, [preferences]);

  const { data, isLoading, refetch } = useQuery<NotificationsResponse>({
    queryKey: INAPP_NOTIFICATIONS_QUERY_KEY,
    queryFn: async () => {
      const res = await apiClient.get<AppNotification[]>("/api/v1/notifications?limit=30");
      const unreadItems = (res.data ?? []).filter((n) => !n.read);
      return {
        data: unreadItems,
        meta: {
          unreadCount:
            (res as unknown as { meta?: { unreadCount: number } }).meta?.unreadCount ??
            unreadItems.length,
        },
      };
    },
    staleTime: 30_000,
  });

  const { markEntityRead } = useMarkEntityNotificationsRead();

  const notifications = data?.data ?? [];
  const unreadCount = data?.meta.unreadCount ?? 0;

  // Мутация: пометить все как прочитанные (сразу очищаем список непрочитанных)
  const markAllMutation = useMutation({
    mutationFn: async () => {
      await apiClient.post("/api/v1/notifications/mark-all-read");
    },
    onMutate: () => {
      queryClient.setQueryData<NotificationsResponse>(INAPP_NOTIFICATIONS_QUERY_KEY, {
        data: [],
        meta: { unreadCount: 0 },
      });
    },
    onSuccess: () => {
      toast.success("Все уведомления прочитаны");
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: INAPP_NOTIFICATIONS_QUERY_KEY });
    },
  });

  // Мутация: пометить одно как прочитанное (сразу убираем из списка непрочитанных)
  const markOneMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiClient.post(`/api/v1/notifications/${id}/read`);
    },
    onMutate: (id) => {
      queryClient.setQueryData<NotificationsResponse>(INAPP_NOTIFICATIONS_QUERY_KEY, (old) => {
        if (!old) return { data: [], meta: { unreadCount: 0 } };
        const target = old.data.find((n) => n.id === id);
        const hadUnread = Boolean(target && !target.read);
        return {
          data: old.data.filter((n) => n.id !== id),
          meta: {
            unreadCount: Math.max(0, old.meta.unreadCount - (hadUnread ? 1 : 0)),
          },
        };
      });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: INAPP_NOTIFICATIONS_QUERY_KEY });
    },
  });

  const markOneRead = useCallback(
    (id: string) => {
      markOneMutation.mutate(id);
    },
    [markOneMutation],
  );

  const markOneReadRef = useRef(markOneRead);
  useEffect(() => {
    markOneReadRef.current = markOneRead;
  }, [markOneRead]);

  // Синхронизация системного счетчика бейджа на иконке PWA (Android One UI / Desktop)
  useEffect(() => {
    if (typeof window === "undefined") return;
    if ("setAppBadge" in navigator) {
      if (preferences.notifications_enabled && unreadCount > 0) {
        navigator.setAppBadge(unreadCount).catch(() => {});
      } else if ("clearAppBadge" in navigator) {
        navigator.clearAppBadge().catch(() => {});
      }
    }
  }, [unreadCount, preferences.notifications_enabled]);

  // Realtime SSE подключение для мгновенной доставки и синхронизации прочтения уведомлений
  useEffect(() => {
    if (typeof window === "undefined") return;

    // В браузере используем куки авторизации
    const eventSource = new EventSource("/api/v1/notifications/stream", {
      withCredentials: true,
    });

    eventSource.addEventListener("notification", (event) => {
      try {
        const item = JSON.parse(event.data) as AppNotification & { data?: { url?: string } };
        if (item.read) return;

        const currentPrefs = preferencesRef.current;
        if (!currentPrefs.notifications_enabled) {
          // Мастер-выключатель выключен: полный режим тишины
          return;
        }

        // Звуковой сигнал
        if (currentPrefs.sound_enabled) {
          playNotificationChime();
        }

        // Всплывающий In-App Toaster
        if (currentPrefs.inapp_enabled) {
          const targetUrl =
            item.data?.url ||
            (item.entity_type === "deal" ? `/crm/deals/${item.entity_id}` : "/dashboard");
          toast(item.title, {
            description: item.description,
            action: {
              label: "Открыть",
              onClick: () => {
                markOneReadRef.current(item.id);
                router.push(targetUrl);
              },
            },
          });
        }

        // Мгновенное обновление кеша в памяти
        queryClient.setQueryData<NotificationsResponse>(INAPP_NOTIFICATIONS_QUERY_KEY, (old) => {
          if (!old) {
            return { data: [item], meta: { unreadCount: 1 } };
          }
          const alreadyExists = old.data.some((n) => n.id === item.id);
          return {
            data: [item, ...old.data.filter((n) => n.id !== item.id && !n.read)],
            meta: {
              unreadCount: old.meta.unreadCount + (alreadyExists ? 0 : 1),
            },
          };
        });
      } catch (err) {
        console.warn("[SSE:Notification] Parse error:", err);
      }
    });

    eventSource.addEventListener("read", (event) => {
      try {
        const payload = JSON.parse(event.data) as { ids?: string[]; all?: boolean };
        if (payload.all) {
          queryClient.setQueryData<NotificationsResponse>(INAPP_NOTIFICATIONS_QUERY_KEY, {
            data: [],
            meta: { unreadCount: 0 },
          });
          return;
        }
        const readIds = new Set(payload.ids ?? []);
        if (readIds.size === 0) return;

        let shouldRefetch = false;
        queryClient.setQueryData<NotificationsResponse>(INAPP_NOTIFICATIONS_QUERY_KEY, (old) => {
          if (!old) return old;
          const remaining = old.data.filter((n) => !readIds.has(n.id));
          const removed = old.data.length - remaining.length;
          const nextUnread = Math.max(0, old.meta.unreadCount - Math.max(removed, readIds.size));
          if (remaining.length === 0 && nextUnread > 0) {
            shouldRefetch = true;
          }
          return {
            data: remaining,
            meta: { unreadCount: nextUnread },
          };
        });
        if (shouldRefetch) {
          void queryClient.invalidateQueries({ queryKey: INAPP_NOTIFICATIONS_QUERY_KEY });
        }
      } catch (err) {
        console.warn("[SSE:NotificationRead] Parse error:", err);
      }
    });

    eventSource.onerror = () => {
      // EventSource сам пробует переподключиться
    };

    return () => {
      eventSource.close();
    };
  }, [queryClient, router]);

  const markAllRead = useCallback(() => {
    markAllMutation.mutate();
  }, [markAllMutation]);

  return {
    notifications,
    unreadCount,
    isLoading,
    refetch,
    markAllRead,
    markOneRead,
    markEntityRead,
  };
}
