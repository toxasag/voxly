"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { API_BASE_URL, apiClient } from "@/lib/api/apiClient";
import { readAccessToken } from "@/lib/auth/session";

export interface ChatMessageEventData {
  id: string;
  deal_id: string;
  source: "manager" | "client" | "ai" | "system";
  direction: "inbound" | "outbound" | "neutral";
  sender_name: string;
  content: string;
  channel: string;
  created_at: string;
  delivery_status?: "neutral" | "pending" | "sent" | "failed";
}

export interface UseChatStreamOptions {
  dealId?: string;
  apiBaseUrl?: string;
  enabled?: boolean;
  onMessage?: (message: ChatMessageEventData) => void;
  onDeliveryUpdate?: (data: { messageId?: string; messageIds?: string[]; status: string; readAt?: string }) => void;
  onPresenceUpdate?: (data: { entityType: string; entityId: string; isOnline: boolean; lastSeenAt: string }) => void;
}

export function useChatStream({
  dealId,
  apiBaseUrl = API_BASE_URL,
  enabled = true,
  onMessage,
  onDeliveryUpdate,
  onPresenceUpdate,
}: UseChatStreamOptions) {
  const [isConnected, setIsConnected] = useState(false);
  const [lastEventTime, setLastEventTime] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const pollingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTimeRef = useRef<string | null>(null);

  // Храним колбэки в ref, чтобы инлайновые обработчики не пересоздавали EventSource на каждый рендер
  const onMessageRef = useRef(onMessage);
  const onDeliveryUpdateRef = useRef(onDeliveryUpdate);
  const onPresenceUpdateRef = useRef(onPresenceUpdate);

  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    onDeliveryUpdateRef.current = onDeliveryUpdate;
  }, [onDeliveryUpdate]);

  useEffect(() => {
    onPresenceUpdateRef.current = onPresenceUpdate;
  }, [onPresenceUpdate]);

  const pollDelta = useCallback(async () => {
    try {
      const json = (await apiClient.get<ChatMessageEventData[]>("/api/v1/crm/chat/delta", {
        query: {
          dealId: dealId || undefined,
          since: lastTimeRef.current || undefined,
        },
      })) as { data: ChatMessageEventData[]; serverTime?: string };
      if (json.data && json.data.length > 0) {
        json.data.forEach((msg) => onMessageRef.current?.(msg));
      }
      if (json.serverTime) {
        lastTimeRef.current = json.serverTime;
        setLastEventTime(json.serverTime);
      }
    } catch {
      // ignore delta poll failure
    }
  }, [dealId]);

  useEffect(() => {
    if (!enabled) return;

    let stopped = false;

    const stopPolling = () => {
      if (pollingTimerRef.current) {
        clearInterval(pollingTimerRef.current);
        pollingTimerRef.current = null;
      }
    };

    const startPollingFallback = () => {
      if (stopped || pollingTimerRef.current) return;
      setIsConnected(false);
      pollingTimerRef.current = setInterval(() => {
        void pollDelta();
      }, 5000);
    };

    const connectSse = () => {
      if (stopped) return;
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }

      const url = new URL(`${apiBaseUrl}/api/v1/crm/chat/stream`, window.location.href);
      if (dealId) url.searchParams.set("dealId", dealId);
      const token = readAccessToken();
      if (token) url.searchParams.set("token", token);

      try {
        const es = new EventSource(url.toString(), { withCredentials: true });
        eventSourceRef.current = es;

        es.onopen = () => {
          if (stopped) {
            es.close();
            return;
          }
          setIsConnected(true);
          stopPolling();
        };

        es.addEventListener("message_created", (event: MessageEvent) => {
          try {
            const payload = JSON.parse(event.data) as { data: ChatMessageEventData; timestamp: string };
            if (payload.data) {
              onMessageRef.current?.(payload.data);
            }
            if (payload.timestamp) {
              lastTimeRef.current = payload.timestamp;
              setLastEventTime(payload.timestamp);
            }
          } catch {}
        });

        es.addEventListener("delivery_updated", (event: MessageEvent) => {
          try {
            const payload = JSON.parse(event.data) as {
              data: { messageId?: string; messageIds?: string[]; status: string; readAt?: string };
            };
            if (payload.data) {
              onDeliveryUpdateRef.current?.(payload.data);
            }
          } catch {}
        });

        es.addEventListener("presence_updated", (event: MessageEvent) => {
          try {
            const payload = JSON.parse(event.data) as {
              data: { entityType: string; entityId: string; isOnline: boolean; lastSeenAt: string };
            };
            if (payload.data) {
              onPresenceUpdateRef.current?.(payload.data);
            }
          } catch {}
        });

        es.onerror = () => {
          es.close();
          if (eventSourceRef.current === es) {
            eventSourceRef.current = null;
          }
          startPollingFallback();
          if (!stopped && !reconnectTimerRef.current) {
            reconnectTimerRef.current = setTimeout(() => {
              reconnectTimerRef.current = null;
              connectSse();
            }, 15_000);
          }
        };
      } catch {
        startPollingFallback();
      }
    };

    connectSse();

    return () => {
      stopped = true;
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      stopPolling();
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };
  }, [dealId, apiBaseUrl, enabled, pollDelta]);

  return {
    isConnected,
    lastEventTime,
  };
}
