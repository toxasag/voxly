"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { apiClient } from "@/lib/api/apiClient";

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");

  const rawData = window.atob(base64);
  const buffer = new ArrayBuffer(rawData.length);
  const outputArray = new Uint8Array(buffer);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export type PushPermissionState = "default" | "granted" | "denied" | "unsupported";

export function useWebPush() {
  const [isSupported, setIsSupported] = useState(false);
  const [permission, setPermission] = useState<PushPermissionState>("default");
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Проверка поддержки и существующей подписки
  const checkSubscription = useCallback(async () => {
    if (typeof window === "undefined") return;

    const supported =
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window;

    setIsSupported(supported);

    if (!supported) {
      setPermission("unsupported");
      setIsLoading(false);
      return;
    }

    setPermission(Notification.permission as PushPermissionState);

    try {
      const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      const sub = await registration.pushManager.getSubscription();
      setIsSubscribed(Boolean(sub));
    } catch (err) {
      console.warn("[WebPush] Error checking subscription:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void checkSubscription();
  }, [checkSubscription]);

  // Подписка на уведомления
  const subscribe = useCallback(async () => {
    if (!isSupported) {
      toast.error("Ваш браузер не поддерживает Web Push уведомления");
      return false;
    }

    setIsLoading(true);

    try {
      // 1. Запрос разрешения пользователя
      const perm = await Notification.requestPermission();
      setPermission(perm as PushPermissionState);

      if (perm !== "granted") {
        toast.error("Разрешение на уведомления не было предоставлено");
        setIsLoading(false);
        return false;
      }

      // 2. Получение VAPID открытого ключа с бэкенда
      const vapidRes = await apiClient.get<{ publicKey: string }>(
        "/api/v1/notifications/vapid-public-key",
      );

      const vapidPublicKey = vapidRes.data?.publicKey;
      if (!vapidPublicKey) {
        throw new Error("Не удалось получить VAPID ключ с сервера");
      }

      // 3. Регистрация Service Worker
      const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      const readyReg = await navigator.serviceWorker.ready;

      // 4. Подписка в PushManager
      const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey);
      const pushSubscription = await readyReg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });

      const p256dhKey = pushSubscription.getKey("p256dh");
      const authKey = pushSubscription.getKey("auth");

      if (!p256dhKey || !authKey) {
        throw new Error("Не удалось извлечь криптографические ключи устройства");
      }

      const p256dh = btoa(String.fromCharCode(...new Uint8Array(p256dhKey)));
      const auth = btoa(String.fromCharCode(...new Uint8Array(authKey)));

      // 5. Отправка подписки на бэкенд
      await apiClient.post("/api/v1/notifications/subscribe", {
        endpoint: pushSubscription.endpoint,
        keys: { p256dh, auth },
        userAgent: navigator.userAgent,
      });

      setIsSubscribed(true);
      toast.success("Уведомления на этом устройстве успешно включены");
      return true;
    } catch (err) {
      console.error("[WebPush] Subscribe error:", err);
      toast.error(err instanceof Error ? err.message : "Ошибка при включении уведомлений");
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [isSupported]);

  // Отписка от уведомлений
  const unsubscribe = useCallback(async () => {
    if (!isSupported) return false;
    setIsLoading(true);

    try {
      const registration = await navigator.serviceWorker.ready;
      const sub = await registration.pushManager.getSubscription();
      if (sub) {
        await sub.unsubscribe();
        await apiClient.post("/api/v1/notifications/unsubscribe", {
          endpoint: sub.endpoint,
        });
      }
      setIsSubscribed(false);
      toast.success("Уведомления на этом устройстве отключены");
      return true;
    } catch (err) {
      console.error("[WebPush] Unsubscribe error:", err);
      toast.error("Не удалось отключить уведомления");
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [isSupported]);

  // Отправка тестового уведомления
  const sendTestNotification = useCallback(async () => {
    try {
      await apiClient.post("/api/v1/notifications/test", {
        title: "Тестовое уведомление GETVOXLY",
        body: "Web Push доставка успешно работает на этом устройстве!",
        url: "/dashboard",
      });
      toast.success("Тестовое уведомление отправлено в очередь");
    } catch (err) {
      toast.error("Ошибка при отправке тестового уведомления");
    }
  }, []);

  return {
    isSupported,
    permission,
    isSubscribed,
    isLoading,
    subscribe,
    unsubscribe,
    sendTestNotification,
  };
}
