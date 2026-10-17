"use client";

import { useEffect, useRef, useState, useCallback } from "react";

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
  onDeliveryUpdate?: (data: { messageId: string; status: string }) => void;
}

export function useChatStream({
  dealId,
  apiBaseUrl = process.env.NEXT_PUBLIC_API_URL ?? "",
  enabled = true,
  onMessage,
  onDeliveryUpdate,
}: UseChatStreamOptions) {
  const [isConnected, setIsConnected] = useState(false);
  const [lastEventTime, setLastEventTime] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const pollingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastTimeRef = useRef<string | null>(null);

  const pollDelta = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      if (dealId) qs.set("dealId", dealId);
      if (lastTimeRef.current) qs.set("since", lastTimeRef.current);

      const res = await fetch(`${apiBaseUrl}/api/v1/crm/chat/delta?${qs.toString()}`, {
        credentials: "include",
      });
      if (res.ok) {
        const json = (await res.json()) as { data: ChatMessageEventData[]; serverTime: string };
        if (json.data && json.data.length > 0) {
          json.data.forEach((msg) => onMessage?.(msg));
        }
        if (json.serverTime) {
          lastTimeRef.current = json.serverTime;
          setLastEventTime(json.serverTime);
        }
      }
    } catch (e) {
      // ignore delta poll failure
    }
  }, [dealId, apiBaseUrl, onMessage]);

  useEffect(() => {
    if (!enabled) return;

    let stopped = false;
    const url = new URL(`${apiBaseUrl}/api/v1/crm/chat/stream`, window.location.href);
    if (dealId) url.searchParams.set("dealId", dealId);

    const startPollingFallback = () => {
      if (stopped || pollingTimerRef.current) return;
      setIsConnected(false);
      pollingTimerRef.current = setInterval(() => {
        void pollDelta();
      }, 5000);
    };

    try {
      const es = new EventSource(url.toString(), { withCredentials: true });
      eventSourceRef.current = es;

      es.onopen = () => {
        setIsConnected(true);
        if (pollingTimerRef.current) {
          clearInterval(pollingTimerRef.current);
          pollingTimerRef.current = null;
        }
      };

      es.addEventListener("message_created", (event: MessageEvent) => {
        try {
          const payload = JSON.parse(event.data) as { data: ChatMessageEventData; timestamp: string };
          if (payload.data) {
            onMessage?.(payload.data);
          }
          if (payload.timestamp) {
            lastTimeRef.current = payload.timestamp;
            setLastEventTime(payload.timestamp);
          }
        } catch {}
      });

      es.addEventListener("delivery_updated", (event: MessageEvent) => {
        try {
          const payload = JSON.parse(event.data) as { data: { messageId: string; status: string } };
          if (payload.data) {
            onDeliveryUpdate?.(payload.data);
          }
        } catch {}
      });

      es.onerror = () => {
        es.close();
        startPollingFallback();
      };
    } catch {
      startPollingFallback();
    }

    return () => {
      stopped = true;
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (pollingTimerRef.current) {
        clearInterval(pollingTimerRef.current);
        pollingTimerRef.current = null;
      }
    };
  }, [dealId, apiBaseUrl, enabled, pollDelta, onMessage, onDeliveryUpdate]);

  return {
    isConnected,
    lastEventTime,
  };
}
