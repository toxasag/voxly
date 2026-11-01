"use client";

import { useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiClient } from "@/lib/api/apiClient";
import type { AppNotification } from "@/types";

interface NotificationsResponse {
  data: AppNotification[];
  meta: {
    unreadCount: number;
  };
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

  const { data, isLoading, refetch } = useQuery<NotificationsResponse>({
    queryKey: ["inapp-notifications"],
    queryFn: async () => {
      const res = await apiClient.get<AppNotification[]>("/api/v1/notifications?limit=30");
      return {
        data: res.data ?? [],
        meta: {
          unreadCount: (res as unknown as { meta?: { unreadCount: number } }).meta?.unreadCount ?? 0,
        },
      };
    },
    staleTime: 30_000,
  });

  const notifications = data?.data ?? [];
  const unreadCount = data?.meta.unreadCount ?? 0;

  // Realtime SSE подключение для мгновенной доставки уведомлений во вкладку
  useEffect(() => {
    if (typeof window === "undefined") return;

    // В браузере используем куки авторизации
    const eventSource = new EventSource("/api/v1/notifications/stream", {
      withCredentials: true,
    });

    eventSource.addEventListener("notification", (event) => {
      try {
        const item = JSON.parse(event.data) as AppNotification & { data?: { url?: string } };

        // Звуковой сигнал
        playNotificationChime();

        // Всплывающий In-App Toaster
        const targetUrl = item.data?.url || (item.entity_type === "deal" ? `/crm/deals/${item.entity_id}` : "/dashboard");
        toast(item.title, {
          description: item.description,
          action: {
            label: "Открыть",
            onClick: () => router.push(targetUrl),
          },
        });

        // Мгновенное обновление кеша в памяти
        queryClient.setQueryData<NotificationsResponse>(["inapp-notifications"], (old) => {
          if (!old) {
            return { data: [item], meta: { unreadCount: 1 } };
          }
          return {
            data: [item, ...old.data.filter((n) => n.id !== item.id)],
            meta: {
              unreadCount: old.meta.unreadCount + 1,
            },
          };
        });
      } catch (err) {
        console.warn("[SSE:Notification] Parse error:", err);
      }
    });

    eventSource.onerror = () => {
      // EventSource сам пробует переподключиться
    };

    return () => {
      eventSource.close();
    };
  }, [queryClient, router]);

  // Мутация: пометить все как прочитанные
  const markAllMutation = useMutation({
    mutationFn: async () => {
      await apiClient.post("/api/v1/notifications/mark-all-read");
    },
    onSuccess: () => {
      queryClient.setQueryData<NotificationsResponse>(["inapp-notifications"], (old) => {
        if (!old) return { data: [], meta: { unreadCount: 0 } };
        return {
          data: old.data.map((n) => ({ ...n, read: true })),
          meta: { unreadCount: 0 },
        };
      });
      toast.success("Все уведомления прочитаны");
    },
  });

  // Мутация: пометить одно как прочитанное
  const markOneMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiClient.post(`/api/v1/notifications/${id}/read`);
    },
    onSuccess: (_, id) => {
      queryClient.setQueryData<NotificationsResponse>(["inapp-notifications"], (old) => {
        if (!old) return { data: [], meta: { unreadCount: 0 } };
        let hadUnread = false;
        const updated = old.data.map((n) => {
          if (n.id === id) {
            if (!n.read) hadUnread = true;
            return { ...n, read: true };
          }
          return n;
        });
        return {
          data: updated,
          meta: {
            unreadCount: Math.max(0, old.meta.unreadCount - (hadUnread ? 1 : 0)),
          },
        };
      });
    },
  });

  const markAllRead = useCallback(() => {
    markAllMutation.mutate();
  }, [markAllMutation]);

  const markOneRead = useCallback(
    (id: string) => {
      markOneMutation.mutate(id);
    },
    [markOneMutation],
  );

  return {
    notifications,
    unreadCount,
    isLoading,
    refetch,
    markAllRead,
    markOneRead,
  };
}
