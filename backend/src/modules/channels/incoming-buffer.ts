// ---------------------------------------------------------------------------
// Буфер дебаунса входящих сообщений.
//
// Задача: человек пишет в мессенджер не абзацами, а очередями коротких реплик —
// «привет», «у меня не работает телефон», «после падения». Отвечать на каждую
// отдельно значит трижды вызвать модель, трижды списать деньги и получить три
// несвязных ответа. Буфер собирает пачку за 15–20 секунд и отдаёт её одним
// текстом.
//
// Почему в памяти процесса, а не в Redis: буфер живёт секунды и осмыслен только
// вместе с MTProto-соединением, которое тоже живёт в этом процессе. При падении
// контейнера соединение обрывается, и восстанавливать недоставленный буфер
// некуда — клиент напишет снова. Redis добавил бы сетевую зависимость на путь,
// где она ничего не гарантирует. (В стеке Redis есть, но он принадлежит
// сторонним сервисам `automation-*`, не GETVOXLY.)
//
// Модуль намеренно без обращений к БД и сети: это чистая механика таймеров, и
// она покрывается юнит-тестами с поддельным временем.
// ---------------------------------------------------------------------------

/**
 * Окно ожидания.
 *
 * Задание требует 15–20 секунд. Берётся случайное значение из диапазона, а не
 * фиксированное: одинаковая пауза у всех диалогов делает ответы машинно
 * узнаваемыми, а разброс в пять секунд ничего не стоит.
 */
export const DEBOUNCE_MIN_MS = 15_000;
export const DEBOUNCE_MAX_MS = 20_000;

/**
 * Предел ожидания с момента ПЕРВОГО сообщения.
 *
 * Без него клиент, который печатает не останавливаясь, никогда не получил бы
 * ответа: каждое новое сообщение продлевало бы таймер. 60 секунд — граница, после
 * которой пачка уходит в модель независимо от того, продолжает ли человек писать.
 */
export const DEBOUNCE_MAX_TOTAL_MS = 60_000;

/**
 * Предел размера буфера.
 *
 * Защита от расхода контекста и денег: 30 реплик по 4000 символов — это уже
 * больше окна части моделей, а платить за такой промпт нечем оправдать. Лишние
 * сообщения отбрасываются с отметкой в логе, а не удлиняют промпт бесконечно.
 */
export const BUFFER_MAX_MESSAGES = 30;
export const BUFFER_MAX_CHARS = 8000;

/** Ключ буфера: один и тот же chat_id у разных аккаунтов — разные диалоги. */
export function bufferKey(input: { channelAccountId: string; chatId: string }): string {
  return `${input.channelAccountId}:${input.chatId}`;
}

export interface BufferedIncoming {
  channelAccountId: string;
  tenantId: string;
  chatId: string;
  /** Идентификатор собеседника на стороне канала — для отправки ответа. */
  peerId: string;
  /** Склеенный текст пачки. */
  text: string;
  /** Сколько сообщений вошло в пачку: попадает в лог, помогает объяснить расход. */
  messageCount: number;
  firstMessageAt: Date;
}

interface BufferEntry {
  tenantId: string;
  channelAccountId: string;
  chatId: string;
  peerId: string;
  parts: string[];
  chars: number;
  droppedParts: number;
  firstMessageAt: Date;
  timer: NodeJS.Timeout;
  /** Абсолютный дедлайн от первого сообщения: продление не должно его обходить. */
  hardDeadlineAt: number;
}

interface Logger {
  info: (obj: object, message: string) => void;
  warn: (obj: object, message: string) => void;
  error: (obj: object, message: string) => void;
}

/** Случайная задержка в окне: разброс делает ответ менее машинным. */
function nextDelayMs(): number {
  return DEBOUNCE_MIN_MS + Math.floor(Math.random() * (DEBOUNCE_MAX_MS - DEBOUNCE_MIN_MS + 1));
}

export class IncomingMessageBuffer {
  private readonly entries = new Map<string, BufferEntry>();

  /**
   * @param flush вызывается по истечении окна; исключения из него не должны
   *   ронять процесс, поэтому перехватываются здесь.
   */
  constructor(
    private readonly flush: (batch: BufferedIncoming) => Promise<void>,
    private readonly log: Logger,
  ) {}

  /** Сколько диалогов ждут отправки. Используется тестами и диагностикой. */
  get pendingCount(): number {
    return this.entries.size;
  }

  /**
   * Добавляет сообщение и (пере)запускает таймер.
   *
   * Текст склеивается через `\n`, как требует задание: модель получает пачку как
   * одно сообщение с сохранённым порядком реплик.
   */
  add(input: {
    tenantId: string;
    channelAccountId: string;
    chatId: string;
    peerId: string;
    text: string;
  }): void {
    const key = bufferKey(input);
    const now = Date.now();
    const existing = this.entries.get(key);

    if (existing === undefined) {
      const entry: BufferEntry = {
        tenantId: input.tenantId,
        channelAccountId: input.channelAccountId,
        chatId: input.chatId,
        peerId: input.peerId,
        parts: [input.text],
        chars: input.text.length,
        droppedParts: 0,
        firstMessageAt: new Date(now),
        hardDeadlineAt: now + DEBOUNCE_MAX_TOTAL_MS,
        timer: this.arm(key, nextDelayMs()),
      };

      this.entries.set(key, entry);
      return;
    }

    // Переполнение: сообщение считается, но в промпт не идёт. Отбрасывать молча
    // нельзя — иначе непонятно, почему ответ не учитывает часть сказанного.
    if (
      existing.parts.length >= BUFFER_MAX_MESSAGES ||
      existing.chars + input.text.length > BUFFER_MAX_CHARS
    ) {
      existing.droppedParts += 1;
      this.log.warn(
        {
          channelAccountId: input.channelAccountId,
          chatId: input.chatId,
          buffered: existing.parts.length,
          dropped: existing.droppedParts,
        },
        "Incoming buffer overflow: message excluded from the batch",
      );
    } else {
      existing.parts.push(input.text);
      existing.chars += input.text.length;
    }

    // Продление таймера, но не дальше жёсткого дедлайна: иначе непрерывно
    // печатающий клиент не получил бы ответа никогда.
    clearTimeout(existing.timer);

    const desired = nextDelayMs();
    const remainingToHard = existing.hardDeadlineAt - now;
    const delay = Math.max(0, Math.min(desired, remainingToHard));

    existing.timer = this.arm(key, delay);
  }

  private arm(key: string, delayMs: number): NodeJS.Timeout {
    const timer = setTimeout(() => {
      void this.release(key);
    }, delayMs);

    // `unref()`: иначе ожидающий таймер удерживал бы event loop, и процесс не
    // завершался бы по SIGTERM до истечения окна.
    timer.unref();
    return timer;
  }

  /** Отдаёт пачку обработчику и снимает её с учёта. */
  private async release(key: string): Promise<void> {
    const entry = this.entries.get(key);
    if (entry === undefined) return;

    // Снимается ДО вызова обработчика: пока модель отвечает (это секунды), новые
    // сообщения должны накапливаться в новом буфере, а не попадать в уже
    // отправленный.
    this.entries.delete(key);

    if (entry.droppedParts > 0) {
      this.log.warn(
        { chatId: entry.chatId, dropped: entry.droppedParts },
        "Batch released with dropped messages",
      );
    }

    try {
      await this.flush({
        tenantId: entry.tenantId,
        channelAccountId: entry.channelAccountId,
        chatId: entry.chatId,
        peerId: entry.peerId,
        text: entry.parts.join("\n"),
        messageCount: entry.parts.length,
        firstMessageAt: entry.firstMessageAt,
      });
    } catch (error) {
      // Ошибка ответа не должна ронять слушателя: следующее сообщение клиента
      // создаст новый буфер, а причина уходит в лог.
      this.log.error(
        { error, chatId: entry.chatId, channelAccountId: entry.channelAccountId },
        "Failed to process incoming batch",
      );
    }
  }

  /**
   * Снимает все таймеры без вызова обработчика.
   *
   * Нужно при остановке процесса: обработчик обращается к БД и Telegram, а на
   * shutdown пул уже закрывается — попытка ответить дала бы ошибку соединения
   * вместо чистого завершения.
   */
  clear(): void {
    for (const entry of this.entries.values()) clearTimeout(entry.timer);
    this.entries.clear();
  }
}
