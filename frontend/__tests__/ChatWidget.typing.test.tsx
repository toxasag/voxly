import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import * as React from "react";
import { ChatWidget } from "@/components/widgets/ChatWidget";
import {
  WidgetSettings,
  TYPING_EFFECT_STORAGE_KEY,
  TYPING_EVENT_NAME,
  getTypingEffectFromStorage,
  setTypingEffectInStorage,
} from "@/components/widgets/WidgetSettings";

describe("ChatWidget and WidgetSettings Typing Effect", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("getTypingEffectFromStorage defaults to true when localStorage is empty", () => {
    expect(getTypingEffectFromStorage()).toBe(true);
  });

  it("setTypingEffectInStorage saves state and dispatches custom event", () => {
    const eventSpy = vi.fn();
    window.addEventListener(TYPING_EVENT_NAME, eventSpy);

    setTypingEffectInStorage(false);
    expect(window.localStorage.getItem(TYPING_EFFECT_STORAGE_KEY)).toBe("false");
    expect(eventSpy).toHaveBeenCalledTimes(1);

    const eventDetail = eventSpy.mock.calls[0][0] as CustomEvent;
    expect(eventDetail.detail).toEqual({ enabled: false });

    window.removeEventListener(TYPING_EVENT_NAME, eventSpy);
  });

  it("WidgetSettings renders switch and toggles typing effect with localStorage update", () => {
    const onToggle = vi.fn();
    render(
      <WidgetSettings
        language="ru"
        onTypingEffectChange={onToggle}
      />
    );

    // Initial state is ON
    expect(screen.getByText("Типинг-эффект")).toBeDefined();
    expect(screen.getByText("ВКЛ")).toBeDefined();

    const switchBtn = screen.getByRole("switch");
    expect(switchBtn.getAttribute("aria-checked")).toBe("true");

    // Click to toggle OFF
    fireEvent.click(switchBtn);

    expect(onToggle).toHaveBeenCalledWith(false);
    expect(window.localStorage.getItem(TYPING_EFFECT_STORAGE_KEY)).toBe("false");
    expect(screen.getByText("ВЫКЛ")).toBeDefined();
    expect(switchBtn.getAttribute("aria-checked")).toBe("false");
  });

  it("WidgetSettings renders English localization correctly", () => {
    render(<WidgetSettings language="en" />);

    expect(screen.getByText("Typing Effect")).toBeDefined();
    expect(screen.getByText("Character-by-character bot messages with blinking cursor")).toBeDefined();
    expect(screen.getByText("ON")).toBeDefined();

    const switchBtn = screen.getByRole("switch");
    expect(switchBtn.getAttribute("aria-label")).toBe("Typing effect ON/OFF");
  });

  it("ChatWidget renders with accessibility attributes (role=status, aria-live=polite, aria-label='typing effect')", () => {
    render(
      <ChatWidget
        language="ru"
        typingEffectEnabled={true}
        typingSpeed={10}
      />
    );

    const statusContainer = screen.getByRole("status");
    expect(statusContainer).toBeDefined();
    expect(statusContainer.getAttribute("aria-live")).toBe("polite");
    expect(statusContainer.getAttribute("aria-label")).toBe("typing effect");

    // Blinking cursor should be present while typing with aria-hidden="true"
    const cursor = screen.getByTestId("typing-cursor");
    expect(cursor).toBeDefined();
    expect(cursor.getAttribute("aria-hidden")).toBe("true");
    expect(cursor.textContent).toBe("|");
  });

  it("ChatWidget completes typing animation character by character", async () => {
    const testMessage = "Привет!";
    render(
      <ChatWidget
        language="ru"
        typingEffectEnabled={true}
        typingSpeed={5}
        messages={[
          {
            id: "msg-test-1",
            sender: "bot",
            text: testMessage,
          },
        ]}
      />
    );

    // Initial state: cursor is visible, text begins typing
    expect(screen.queryByTestId("typing-cursor")).not.toBeNull();

    // Wait for typing animation to complete
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
    });

    // After completion, cursor is removed and full text is shown
    expect(screen.getByText(testMessage)).toBeDefined();
    expect(screen.queryByTestId("typing-cursor")).toBeNull();
  });

  it("ChatWidget renders text immediately without typing animation when typingEffectEnabled is false", () => {
    const fullText = "Мгновенный ответ без анимации печати";
    render(
      <ChatWidget
        language="ru"
        typingEffectEnabled={false}
        messages={[
          {
            id: "msg-instant-1",
            sender: "bot",
            text: fullText,
          },
        ]}
      />
    );

    // Full text is visible immediately
    expect(screen.getByText(fullText)).toBeDefined();
    // No cursor is rendered
    expect(screen.queryByTestId("typing-cursor")).toBeNull();
  });

  it("ChatWidget updates dynamically on storage/custom event without reload", () => {
    const { rerender } = render(
      <ChatWidget
        language="ru"
        messages={[
          {
            id: "msg-sync-1",
            sender: "bot",
            text: "Тестовое сообщение",
          },
        ]}
      />
    );

    // Emit event disabling typing effect
    act(() => {
      window.dispatchEvent(
        new CustomEvent(TYPING_EVENT_NAME, { detail: { enabled: false } })
      );
    });

    // Component immediately marks typing as instant
    expect(screen.getByText("Тестовое сообщение")).toBeDefined();
    expect(screen.queryByTestId("typing-cursor")).toBeNull();
  });

  it("WidgetSettings renders speed presets 48ms, 24ms, 12ms and invokes callback", () => {
    const onSpeedChange = vi.fn();
    render(
      <WidgetSettings
        language="ru"
        typingSpeed={24}
        onTypingSpeedChange={onSpeedChange}
      />
    );

    expect(screen.getByText("Скорость:")).toBeDefined();
    const smoothBtn = screen.getByText("Плавная");
    const normalBtn = screen.getByText("Норм");
    const fastBtn = screen.getByText("Быстрая");

    expect(smoothBtn).toBeDefined();
    expect(normalBtn).toBeDefined();
    expect(fastBtn).toBeDefined();

    fireEvent.click(smoothBtn);
    expect(onSpeedChange).toHaveBeenCalledWith(48);

    fireEvent.click(fastBtn);
    expect(onSpeedChange).toHaveBeenCalledWith(12);

    fireEvent.click(normalBtn);
    expect(onSpeedChange).toHaveBeenCalledWith(24);
  });

  it("ChatWidget auto-scrolls down during typewriter typing ticks", async () => {
    const longText = "Это первая строка длинного сообщения бота, которое проверяет автоскролл во время набора.";
    const { container } = render(
      <ChatWidget
        language="ru"
        typingEffectEnabled={true}
        typingSpeed={5}
        messages={[
          {
            id: "msg-scroll-test",
            sender: "bot",
            text: longText,
          },
        ]}
      />
    );

    const scrollContainer = container.querySelector(".overflow-y-auto") as HTMLDivElement;
    expect(scrollContainer).not.toBeNull();

    // Mock scrollHeight
    Object.defineProperty(scrollContainer, "scrollHeight", {
      configurable: true,
      value: 600,
    });
    Object.defineProperty(scrollContainer, "clientHeight", {
      configurable: true,
      value: 300,
    });

    // Advance typing timer
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    // scrollTop should have been adjusted toward scrollHeight
    expect(scrollContainer.scrollTop).toBe(600);
  });
});
