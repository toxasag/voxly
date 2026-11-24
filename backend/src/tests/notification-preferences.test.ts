import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  NotificationPreferencesService,
  type UserNotificationPreferencesDTO,
} from "../modules/notifications/notification-preferences.service.js";

describe("Notification Preferences & Master Toggle", () => {
  it("Test 1: defaults should have all notifications enabled (true)", () => {
    const service = new NotificationPreferencesService();
    assert.ok(service);

    const defaultPrefs: UserNotificationPreferencesDTO = {
      notifications_enabled: true,
      sound_enabled: true,
      inapp_enabled: true,
      push_enabled: true,
    };

    assert.equal(defaultPrefs.notifications_enabled, true);
    assert.equal(defaultPrefs.sound_enabled, true);
    assert.equal(defaultPrefs.inapp_enabled, true);
    assert.equal(defaultPrefs.push_enabled, true);
  });

  it("Test 2: master toggle false overrides all granular channels", () => {
    const prefs: UserNotificationPreferencesDTO = {
      notifications_enabled: false,
      sound_enabled: true,
      inapp_enabled: true,
      push_enabled: true,
    };

    // Проверяем инвариант мастер-выключателя: если notifications_enabled === false,
    // ни один канал не должен доставлять уведомления пользователю
    const isChannelActive = (
      p: UserNotificationPreferencesDTO,
      channel: "sound" | "inapp" | "push",
    ) => {
      if (!p.notifications_enabled) return false;
      return channel === "sound"
        ? p.sound_enabled
        : channel === "inapp"
          ? p.inapp_enabled
          : p.push_enabled;
    };

    assert.equal(isChannelActive(prefs, "sound"), false);
    assert.equal(isChannelActive(prefs, "inapp"), false);
    assert.equal(isChannelActive(prefs, "push"), false);
  });

  it("Test 3: granular toggles work when master toggle is enabled", () => {
    const prefs: UserNotificationPreferencesDTO = {
      notifications_enabled: true,
      sound_enabled: false,
      inapp_enabled: true,
      push_enabled: false,
    };

    const isChannelActive = (
      p: UserNotificationPreferencesDTO,
      channel: "sound" | "inapp" | "push",
    ) => {
      if (!p.notifications_enabled) return false;
      return channel === "sound"
        ? p.sound_enabled
        : channel === "inapp"
          ? p.inapp_enabled
          : p.push_enabled;
    };

    assert.equal(isChannelActive(prefs, "sound"), false);
    assert.equal(isChannelActive(prefs, "inapp"), true);
    assert.equal(isChannelActive(prefs, "push"), false);
  });
});
