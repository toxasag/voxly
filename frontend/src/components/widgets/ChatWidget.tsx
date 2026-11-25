"use client";

import * as React from "react";
import { useState, useEffect, useRef, useCallback } from "react";
import { cn } from "@/lib/utils";
import type { ChatWidgetProps, ChatMessage, WidgetLanguage } from "@/types/widget";
import {
  TYPING_EFFECT_STORAGE_KEY,
  TYPING_EVENT_NAME,
  getTypingEffectFromStorage,
  WidgetSettings,
} from "./WidgetSettings";
import {
  Send,
  Bot,
  User,
  Sparkles,
  RotateCcw,
  Settings2,
  CheckCircle2,
} from "lucide-react";

const DEFAULT_GREETING_RU =
  "Здравствуйте! Я ваш виртуальный консультант GETVOXLY. Чем я могу помочь вам сегодня?";
const DEFAULT_GREETING_EN =
  "Hello! I am your GETVOXLY virtual assistant. How can I assist you today?";

export const ChatWidget: React.FC<ChatWidgetProps> = ({
  messages: initialMessages,
  title,
  subtitle,
  botName,
  botAvatar,
  language = "ru",
  typingSpeed = 24,
  typingEffectEnabled: controlledEnabled,
  onSendMessage,
  className,
  showSettingsToggle = false,
}) => {
  const isRu = language === "ru";

  // Typing effect enabled state (controlled or synced with localStorage)
  const [internalTypingEnabled, setInternalTypingEnabled] = useState<boolean>(
    () => {
      if (typeof controlledEnabled === "boolean") return controlledEnabled;
      return getTypingEffectFromStorage();
    },
  );

  const isTypingEffectOn =
    typeof controlledEnabled === "boolean"
      ? controlledEnabled
      : internalTypingEnabled;

  // Sync with localStorage & custom events
  useEffect(() => {
    const handleCustomEvent = (e: Event) => {
      const customEvent = e as CustomEvent<{ enabled: boolean }>;
      if (customEvent.detail && typeof customEvent.detail.enabled === "boolean") {
        setInternalTypingEnabled(customEvent.detail.enabled);
      }
    };

    const handleStorage = (e: StorageEvent) => {
      if (e.key === TYPING_EFFECT_STORAGE_KEY && e.newValue !== null) {
        setInternalTypingEnabled(e.newValue === "true");
      }
    };

    window.addEventListener(TYPING_EVENT_NAME, handleCustomEvent);
    window.addEventListener("storage", handleStorage);

    return () => {
      window.removeEventListener(TYPING_EVENT_NAME, handleCustomEvent);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  // Internal message list
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    if (initialMessages && initialMessages.length > 0) return initialMessages;
    return [
      {
        id: "msg-welcome-1",
        sender: "bot",
        text: isRu ? DEFAULT_GREETING_RU : DEFAULT_GREETING_EN,
        timestamp: Date.now(),
      },
    ];
  });

  // Track completed & active message IDs with Refs to eliminate re-render race conditions
  const completedMessageIdsRef = useRef<Set<string>>(new Set());
  const activeMessageIdRef = useRef<string | null>(null);

  // Active typing state for UI rendering
  const [activeTypingMessageId, setActiveTypingMessageId] = useState<
    string | null
  >(null);
  const [displayedText, setDisplayedText] = useState<string>("");
  const typingTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Chat scroll container with sticky auto-scroll logic
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef<boolean>(true);

  const handleScroll = useCallback(() => {
    if (!scrollContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    const distanceFromBottom = scrollHeight - (scrollTop + clientHeight);
    isNearBottomRef.current = distanceFromBottom <= 100;
  }, []);

  const scrollToBottom = useCallback((force = false) => {
    if (!scrollContainerRef.current) return;
    if (force || isNearBottomRef.current) {
      scrollContainerRef.current.scrollTop =
        scrollContainerRef.current.scrollHeight;
    }
  }, []);

  // Typing animation function
  const typeWriter = useCallback(
    (
      fullText: string,
      messageId: string,
      speed: number,
      onComplete?: () => void,
    ) => {
      if (typingTimerRef.current) {
        clearTimeout(typingTimerRef.current);
      }

      activeMessageIdRef.current = messageId;
      setActiveTypingMessageId(messageId);
      setDisplayedText("");

      let index = 0;
      const totalLen = fullText.length;

      const step = () => {
        if (index < totalLen) {
          index++;
          setDisplayedText(fullText.slice(0, index));
          // Auto-scroll on each tick / line wrap so text is never hidden behind input
          scrollToBottom(false);
          typingTimerRef.current = setTimeout(step, speed);
        } else {
          // Finished: mark completed synchronously
          completedMessageIdsRef.current.add(messageId);
          activeMessageIdRef.current = null;
          setActiveTypingMessageId(null);
          scrollToBottom(false);
          onComplete?.();
        }
      };

      step();
    },
    [scrollToBottom],
  );

  // Trigger typing effect for bot messages
  useEffect(() => {
    // If typing effect is OFF, mark all existing bot messages as completed immediately
    if (!isTypingEffectOn) {
      if (typingTimerRef.current) {
        clearTimeout(typingTimerRef.current);
        typingTimerRef.current = null;
      }
      activeMessageIdRef.current = null;
      setActiveTypingMessageId(null);
      messages.forEach((m) => completedMessageIdsRef.current.add(m.id));
      return;
    }

    // Find bot message that hasn't completed and is not currently typing
    const candidate = messages.find(
      (m) =>
        m.sender === "bot" &&
        !completedMessageIdsRef.current.has(m.id) &&
        activeMessageIdRef.current !== m.id,
    );

    if (candidate) {
      isNearBottomRef.current = true;
      scrollToBottom(true);
      typeWriter(candidate.text, candidate.id, typingSpeed);
    }
  }, [messages, isTypingEffectOn, typingSpeed, typeWriter, scrollToBottom]);

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (typingTimerRef.current) {
        clearTimeout(typingTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    scrollToBottom(false);
  }, [messages, displayedText, scrollToBottom]);

  // Input state
  const [inputValue, setInputValue] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSend = () => {
    const trimmed = inputValue.trim();
    if (!trimmed || isSubmitting) return;

    const userMsgId = `user-${Date.now()}`;
    const userMsg: ChatMessage = {
      id: userMsgId,
      sender: "user",
      text: trimmed,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputValue("");
    isNearBottomRef.current = true;
    scrollToBottom(true);
    onSendMessage?.(trimmed);

    // Simulate smart bot response
    setIsSubmitting(true);
    setTimeout(() => {
      const botResponsesRu = [
        `Спасибо за ваш вопрос: «${trimmed}». Наша команда уже анализирует его и готова предоставить лучшее решение!`,
        `Отличный вопрос! В GETVOXLY эта функция настраивается в 2 клика. Хотите подключить демо?`,
        `Принято! Мы сохранили ваш запрос и свяжемся с вами в течение пары минут.`,
      ];
      const botResponsesEn = [
        `Thank you for reaching out: "${trimmed}". Our platform has processed your inquiry!`,
        `Great question! This capability is natively supported in GETVOXLY. Would you like a demo?`,
        `Received! Your inquiry is being prioritized by our team.`,
      ];
      const pool = isRu ? botResponsesRu : botResponsesEn;
      const replyText = pool[Math.floor(Math.random() * pool.length)];

      const botMsgId = `bot-${Date.now()}`;
      const botMsg: ChatMessage = {
        id: botMsgId,
        sender: "bot",
        text: replyText,
        timestamp: Date.now(),
      };

      setMessages((prev) => [...prev, botMsg]);
      setIsSubmitting(false);
    }, 225);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleResetConversation = () => {
    if (typingTimerRef.current) {
      clearTimeout(typingTimerRef.current);
      typingTimerRef.current = null;
    }
    completedMessageIdsRef.current.clear();
    activeMessageIdRef.current = null;
    setActiveTypingMessageId(null);
    const resetGreeting: ChatMessage = {
      id: `msg-welcome-${Date.now()}`,
      sender: "bot",
      text: isRu ? DEFAULT_GREETING_RU : DEFAULT_GREETING_EN,
      timestamp: Date.now(),
    };
    setMessages([resetGreeting]);
  };

  const displayTitle = title || (isRu ? "Онлайн-консультант" : "Support Chat");
  const displaySubtitle =
    subtitle || (isRu ? "Мы онлайн и готовы помочь" : "We are online and ready to help");
  const displayBotName = botName || "GETVOXLY AI";

  return (
    <div
      className={cn(
        "flex flex-col h-[520px] w-full max-w-[420px] rounded-2xl border border-[#e5e5e5] bg-white shadow-xl overflow-hidden text-[#111111]",
        className,
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#e5e5e5] bg-[#fbfbfb] px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-[#4a38f5] text-white shadow-xs">
            {botAvatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={botAvatar}
                alt={displayBotName}
                className="h-full w-full rounded-xl object-cover"
              />
            ) : (
              <Bot className="h-5 w-5" />
            )}
            <span
              className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white bg-emerald-500"
              title="Online"
            />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <h3 className="text-[14px] font-semibold text-[#111111]">
                {displayTitle}
              </h3>
              <span className="inline-flex items-center rounded-full bg-emerald-50 px-1.5 py-0.2 text-[10px] font-medium text-emerald-700">
                {isRu ? "Онлайн" : "Online"}
              </span>
            </div>
            <p className="text-[11px] text-[#666666]">{displaySubtitle}</p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleResetConversation}
            title={isRu ? "Перезапустить диалог" : "Reset conversation"}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[#666666] hover:bg-gray-100 hover:text-[#111111] transition-colors"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Quick Settings Bar if requested */}
      {showSettingsToggle && (
        <div className="border-b border-[#f0f0f0] bg-gray-50/70 px-3 py-1.5">
          <WidgetSettings
            typingEffectEnabled={isTypingEffectOn}
            onTypingEffectChange={(val) => setInternalTypingEnabled(val)}
            language={language}
            className="border-none shadow-none bg-transparent p-0"
          />
        </div>
      )}

      {/* Messages area */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-4 space-y-3.5 bg-white"
      >
        {messages.map((msg) => {
          const isBot = msg.sender === "bot";
          const isCurrentlyTyping = activeTypingMessageId === msg.id;

          let messageRenderText = msg.text;
          if (isBot && isTypingEffectOn) {
            if (isCurrentlyTyping) {
              messageRenderText = displayedText;
            } else if (!completedMessageIdsRef.current.has(msg.id)) {
              messageRenderText = "";
            }
          }

          return (
            <div
              key={msg.id}
              className={cn(
                "flex items-start gap-2.5",
                isBot ? "justify-start" : "justify-end",
              )}
            >
              {isBot && (
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#4a38f5]/10 text-[#4a38f5]">
                  <Bot className="h-4 w-4" />
                </div>
              )}

              <div
                className={cn(
                  "max-w-[80%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed transition-all",
                  isBot
                    ? "rounded-tl-xs border border-[#e5e5e5] bg-[#fbfbfb] text-[#111111]"
                    : "rounded-tr-xs bg-[#4a38f5] text-white shadow-xs",
                )}
              >
                {isBot && (
                  <div className="mb-1 text-[10px] font-medium text-[#888888]">
                    {displayBotName}
                  </div>
                )}

                {/* Accessible text container with typing effect and cursor */}
                <div
                  role="status"
                  aria-live="polite"
                  aria-label="typing effect"
                  className="whitespace-pre-wrap break-words"
                >
                  <span>{messageRenderText}</span>

                  {/* Blinking Cursor during active typing */}
                  {isBot && isCurrentlyTyping && (
                    <span
                      aria-hidden="true"
                      data-testid="typing-cursor"
                      className="inline-block w-[2px] h-[1.1em] ml-0.5 bg-[#111111] animate-pulse align-middle font-mono font-bold select-none"
                    >
                      |
                    </span>
                  )}
                </div>
              </div>

              {!isBot && (
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-[#666666]">
                  <User className="h-4 w-4" />
                </div>
              )}
            </div>
          );
        })}

        {isSubmitting && (
          <div className="flex items-center gap-2 text-[12px] text-[#666666]">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#4a38f5]/10 text-[#4a38f5]">
              <Bot className="h-4 w-4" />
            </div>
            <div className="flex items-center gap-1 rounded-2xl border border-[#e5e5e5] bg-[#fbfbfb] px-3 py-2">
              <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-[#4a38f5]" />
              <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-[#4a38f5] [animation-delay:0.2s]" />
              <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-[#4a38f5] [animation-delay:0.4s]" />
            </div>
          </div>
        )}
      </div>

      {/* Footer / Input */}
      <div className="border-t border-[#e5e5e5] bg-[#fbfbfb] p-3">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              isRu ? "Напишите сообщение..." : "Type your message..."
            }
            className="flex-1 rounded-xl border border-[#e5e5e5] bg-white px-3.5 py-2 text-[13px] text-[#111111] placeholder:text-[#999999] focus:border-[#4a38f5] focus:outline-none focus:ring-2 focus:ring-[#4a38f5]/15 transition-all"
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={!inputValue.trim() || isSubmitting}
            aria-label={isRu ? "Отправить" : "Send message"}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#4a38f5] text-white hover:bg-[#3d2ee0] disabled:opacity-40 disabled:hover:bg-[#4a38f5] transition-colors shadow-xs"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-2 flex items-center justify-between px-1 text-[10px] text-[#888888]">
          <span className="flex items-center gap-1">
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                isTypingEffectOn ? "bg-emerald-500" : "bg-gray-400",
              )}
            />
            {isRu
              ? isTypingEffectOn
                ? "Эффект печати активен"
                : "Печать мгновенная"
              : isTypingEffectOn
                ? "Typing effect active"
                : "Instant typing"}
          </span>
          <span>GETVOXLY Webchat v2.0</span>
        </div>
      </div>
    </div>
  );
};
