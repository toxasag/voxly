/**
 * Парсер текстовых экспортов переписок WhatsApp (_chat.txt).
 *
 * Поддерживает форматы iOS и Android (русская и английская локали),
 * многострочные сообщения, вычищает служебные уведомления шифрования,
 * пропущенных звонков и медиафайлов.
 */

export interface WhatsAppMessage {
  rawTimestamp: string;
  sender: string;
  text: string;
  date?: Date;
}

export interface ParsedWhatsAppChat {
  participants: string[];
  totalMessages: number;
  filteredMessages: number;
  dialogTranscript: string;
  messages: WhatsAppMessage[];
}

// Регулярные выражения для начала сообщений:
// 1. iOS: [24.10.2026, 14:15:30] Имя: текст или [24.10.26, 2:15:30 PM] Name: text
const IOS_REGEX = /^\[(\d{1,2}[./]\d{1,2}[./]\d{2,4},\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s+[APap][Mm])?)\]\s+([^:]+):\s+(.*)$/;

// 2. Android: 24.10.2026, 14:15 - Имя: текст или 10/24/26, 2:15 PM - Name: text
const ANDROID_REGEX = /^(\d{1,2}[./]\d{1,2}[./]\d{2,4},\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s+[APap][Mm])?)\s+-\s+([^:]+):\s+(.*)$/;

// Системные строки WhatsApp, которые не несут смысловой нагрузки
const SYSTEM_PHRASES = [
  "сообщения и звонки защищены",
  "messages and calls are end-to-end encrypted",
  "сквозным шифрованием",
  "<медиафайлы скрыты>",
  "<media omitted>",
  "данное сообщение удалено",
  "this message was deleted",
  "сообщение удалено",
  "пропущенный аудиозвонок",
  "пропущенный видеозвонок",
  "missed voice call",
  "missed video call",
  "изменил(а) номер",
  "добавил(а)",
  "вы удалили это сообщение",
];

export function parseWhatsAppChat(rawText: string): ParsedWhatsAppChat {
  const lines = rawText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const rawMessages: WhatsAppMessage[] = [];
  let currentMsg: WhatsAppMessage | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Проверяем iOS формат
    const iosMatch = trimmed.match(IOS_REGEX);
    if (iosMatch && iosMatch[1] && iosMatch[2] && iosMatch[3] !== undefined) {
      if (currentMsg) rawMessages.push(currentMsg);
      currentMsg = {
        rawTimestamp: iosMatch[1],
        sender: iosMatch[2].trim(),
        text: iosMatch[3].trim(),
      };
      continue;
    }

    // Проверяем Android формат
    const androidMatch = trimmed.match(ANDROID_REGEX);
    if (androidMatch && androidMatch[1] && androidMatch[2] && androidMatch[3] !== undefined) {
      if (currentMsg) rawMessages.push(currentMsg);
      currentMsg = {
        rawTimestamp: androidMatch[1],
        sender: androidMatch[2].trim(),
        text: androidMatch[3].trim(),
      };
      continue;
    }

    // Если это не начало нового сообщения — это продолжение многострочного текста
    if (currentMsg) {
      currentMsg.text += "\n" + trimmed;
    }
  }

  if (currentMsg) {
    rawMessages.push(currentMsg);
  }

  // Фильтруем системные сообщения и служебный спам
  const validMessages = rawMessages.filter((m) => {
    const lower = m.text.toLowerCase();
    for (const phrase of SYSTEM_PHRASES) {
      if (lower.includes(phrase)) return false;
    }
    return m.text.length > 0;
  });

  // Определяем участников
  const participantCounts = new Map<string, number>();
  for (const m of validMessages) {
    participantCounts.set(m.sender, (participantCounts.get(m.sender) ?? 0) + 1);
  }

  const participants = Array.from(participantCounts.keys());

  // Склеиваем последовательные сообщения одного и того же отправителя
  const groupedTurns: { sender: string; text: string }[] = [];
  for (const m of validMessages) {
    const last = groupedTurns[groupedTurns.length - 1];
    if (last && last.sender === m.sender) {
      last.text += "\n" + m.text;
    } else {
      groupedTurns.push({ sender: m.sender, text: m.text });
    }
  }

  // Форматируем в компактный понятный диалог
  const transcriptLines = groupedTurns.map((turn) => `${turn.sender}: ${turn.text}`);
  const dialogTranscript = transcriptLines.join("\n\n");

  return {
    participants,
    totalMessages: rawMessages.length,
    filteredMessages: validMessages.length,
    dialogTranscript,
    messages: validMessages,
  };
}
