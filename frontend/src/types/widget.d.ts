export type WidgetLanguage = "ru" | "en";

export interface ChatMessage {
  id: string;
  sender: "bot" | "user" | "system" | "agent";
  text: string;
  timestamp?: number | string;
  avatar?: string;
  isTyping?: boolean;
}

export interface TypingEffectConfig {
  enabled: boolean;
  speed?: number;
  cursorChar?: string;
  cursorBlink?: boolean;
}

export interface ChatWidgetProps {
  messages?: ChatMessage[];
  title?: string;
  subtitle?: string;
  botName?: string;
  botAvatar?: string;
  language?: WidgetLanguage;
  typingSpeed?: number;
  typingEffectEnabled?: boolean;
  onSendMessage?: (text: string) => void;
  className?: string;
  showSettingsToggle?: boolean;
}

export interface WidgetSettingsProps {
  typingEffectEnabled?: boolean;
  onTypingEffectChange?: (enabled: boolean) => void;
  language?: WidgetLanguage;
  onLanguageChange?: (lang: WidgetLanguage) => void;
  typingSpeed?: number;
  onTypingSpeedChange?: (speed: number) => void;
  className?: string;
}
