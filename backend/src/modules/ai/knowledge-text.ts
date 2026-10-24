import zlib from "node:zlib";
import { AppError } from "../../plugins/errorHandler.js";

// ---------------------------------------------------------------------------
// Извлечение текста из загруженных файлов и разбивка на фрагменты.
//
// Отдельный модуль без обращений к БД и сети: это чистые преобразования, и они
// покрываются юнит-тестами без поднятого приложения.
// ---------------------------------------------------------------------------

/** Поддерживаемые типы. Ключ — расширение, значение — ожидаемый MIME. */
export const SUPPORTED_EXTENSIONS = ["txt", "md", "docx", "pdf", "xlsx", "csv"] as const;
export type SupportedExtension = (typeof SUPPORTED_EXTENSIONS)[number];

/**
 * Предел размера файла.
 *
 * 10 МБ: docx на 10 МБ — это сотни страниц текста, а один документ порождает
 * тысячи фрагментов, каждый из которых оплачивается вызовом эмбеддингов. Предел
 * защищает и от расхода баланса, и от удержания памяти процесса: файл читается
 * в буфер целиком, потокового парсера ни у mammoth, ни у pdf-parse нет.
 */
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

export class UnsupportedDocumentError extends AppError {
  constructor(filename: string) {
    super(
      400,
      "UNSUPPORTED_DOCUMENT_TYPE",
      `Файл «${filename}» не поддерживается. Допустимы txt, md, docx, pdf, xlsx и csv.`,
      { file: ["Допустимы форматы txt, md, docx, pdf, xlsx, csv"] },
    );
  }
}

export class EmptyDocumentError extends AppError {
  constructor(filename: string) {
    super(
      400,
      "EMPTY_DOCUMENT",
      `Из файла «${filename}» не удалось извлечь текст. Возможно, это сканированный документ без текстового слоя.`,
      { file: ["Не удалось извлечь текст: возможно, это скан без текстового слоя"] },
    );
  }
}

export function extensionOf(filename: string): string {
  const match = /\.([A-Za-z0-9]+)$/.exec(filename.trim());
  return match?.[1]?.toLowerCase() ?? "";
}

export function isSupportedExtension(value: string): value is SupportedExtension {
  return (SUPPORTED_EXTENSIONS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Нормализация
// ---------------------------------------------------------------------------

/**
 * Приводит извлечённый текст к пригодному для чанкования виду.
 *
 * Три вещи, каждая по своей причине:
 *  * `\r\n` → `\n`: docx и pdf несут windows-переводы строк, и без нормализации
 *    длина фрагмента считалась бы с лишними символами;
 *  * три и более перевода строки сводятся к двум: pdf-парсер вставляет пустые
 *    строки между блоками страницы, и они занимали бы место в оплачиваемом
 *    фрагменте, ничего не добавляя к смыслу;
 *  * `\u0000` удаляется: PostgreSQL отклоняет нулевой байт в `TEXT` ошибкой
 *    `invalid byte sequence`, а он встречается в pdf, собранных из бинарных
 *    потоков.
 */
export function normaliseText(raw: string): string {
  return raw
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---------------------------------------------------------------------------
// Извлечение
// ---------------------------------------------------------------------------

function readZipFiles(buffer: Buffer): Map<string, string> {
  const files = new Map<string, string>();
  let eocdOffset = -1;
  for (let i = buffer.length - 22; i >= 0; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset !== -1) {
    const cdOffset = buffer.readUInt32LE(eocdOffset + 16);
    const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
    let cur = cdOffset;
    for (let i = 0; i < totalEntries && cur + 46 <= buffer.length; i++) {
      if (buffer.readUInt32LE(cur) !== 0x02014b50) break;
      const compression = buffer.readUInt16LE(cur + 10);
      const compressedSize = buffer.readUInt32LE(cur + 20);
      const nameLen = buffer.readUInt16LE(cur + 28);
      const extraLen = buffer.readUInt16LE(cur + 30);
      const commentLen = buffer.readUInt16LE(cur + 32);
      const localHeaderOffset = buffer.readUInt32LE(cur + 42);
      const fileName = buffer.toString("utf8", cur + 46, cur + 46 + nameLen);

      if (localHeaderOffset + 30 <= buffer.length && buffer.readUInt32LE(localHeaderOffset) === 0x04034b50) {
        const localNameLen = buffer.readUInt16LE(localHeaderOffset + 26);
        const localExtraLen = buffer.readUInt16LE(localHeaderOffset + 28);
        const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
        const compressedData = buffer.subarray(dataStart, dataStart + compressedSize);
        try {
          if (compression === 8) {
            files.set(fileName, zlib.inflateRawSync(compressedData).toString("utf8"));
          } else if (compression === 0) {
            files.set(fileName, compressedData.toString("utf8"));
          }
        } catch {
          // ignore corrupted entry
        }
      }
      cur += 46 + nameLen + extraLen + commentLen;
    }
  }
  return files;
}

function parseXlsx(buffer: Buffer): string {
  const files = readZipFiles(buffer);
  if (files.size === 0) {
    throw new Error("Не удалось прочитать структуру архива XLSX");
  }

  const sharedStrings: string[] = [];
  const sstContent = files.get("xl/sharedStrings.xml");
  if (sstContent) {
    const siMatches = sstContent.match(/<si\b[^>]*>(.*?)<\/si>/gis) ?? [];
    for (const si of siMatches) {
      const textMatches = Array.from(si.matchAll(/<t\b[^>]*>([^<]*)<\/t>/gi));
      const str = textMatches.map((m) => m[1] ?? "").join("");
      sharedStrings.push(
        str
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"'),
      );
    }
  }

  const sheetKeys = Array.from(files.keys())
    .filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(k))
    .sort();
  const outputLines: string[] = [];

  for (const sheetKey of sheetKeys) {
    const sheetXml = files.get(sheetKey);
    if (!sheetXml) continue;

    const rowMatches = sheetXml.match(/<row\b[^>]*>(.*?)<\/row>/gis) ?? [];
    for (const rowXml of rowMatches) {
      const cellMatches = Array.from(rowXml.matchAll(/<c\b([^>]*)>(.*?)<\/c>/gis));
      const cells: string[] = [];

      for (const cell of cellMatches) {
        const attrs = cell[1] ?? "";
        const body = cell[2] ?? "";
        const isString = /t="s"/i.test(attrs);
        const isInline = /t="inlineStr"/i.test(attrs);

        let cellVal = "";
        if (isString) {
          const vMatch = /<v>(\d+)<\/v>/i.exec(body);
          if (vMatch && vMatch[1]) {
            const idx = parseInt(vMatch[1], 10);
            cellVal = sharedStrings[idx] ?? "";
          }
        } else if (isInline) {
          const tMatch = /<t\b[^>]*>([^<]*)<\/t>/i.exec(body);
          cellVal = tMatch?.[1] ?? "";
        } else {
          const vMatch = /<v>([^<]*)<\/v>/i.exec(body);
          cellVal = vMatch?.[1] ?? "";
        }

        cellVal = cellVal
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .trim();
        if (cellVal) {
          cells.push(cellVal);
        }
      }

      if (cells.length > 0) {
        outputLines.push(cells.join(" | "));
      }
    }
  }

  return outputLines.join("\n");
}

/**
 * Достаёт текст из буфера по расширению файла.
 *
 * MIME из запроса не используется как источник истины: браузеры присылают
 * `application/octet-stream` для docx, а curl — что угодно. Расширение проверено
 * вызывающим по закрытому списку.
 */
export async function extractText(input: {
  filename: string;
  extension: SupportedExtension;
  buffer: Buffer;
}): Promise<string> {
  const { extension, buffer, filename } = input;

  if (extension === "txt" || extension === "md" || extension === "csv") {
    return normaliseText(buffer.toString("utf8"));
  }

  if (extension === "xlsx") {
    try {
      const text = parseXlsx(buffer);
      if (!text.trim()) {
        throw new EmptyDocumentError(filename);
      }
      return normaliseText(text);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        400,
        "DOCUMENT_PARSE_FAILED",
        `Не удалось прочитать таблицу «${filename}»: ${error instanceof Error ? error.message : "неизвестная ошибка"}`,
        { file: ["Файл таблицы повреждён или защищён паролем"] },
      );
    }
  }

  if (extension === "docx") {
    // Динамический импорт: mammoth и pdf-parse тянут заметные зависимости, и
    // загружать их при старте сервера ради маршрута, который может не
    // вызываться, незачем.
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    return normaliseText(result.value);
  }

  // pdf
  const pdfModule = await import("pdf-parse");
  // CommonJS-модуль: в ESM он приходит как `{ default }`, но часть сборок
  // экспортирует функцию напрямую.
  const parse = (pdfModule.default ?? pdfModule) as (
    data: Buffer,
  ) => Promise<{ text: string }>;

  try {
    const parsed = await parse(buffer);
    return normaliseText(parsed.text);
  } catch (error) {
    // Битый или зашифрованный pdf — ошибка ввода, а не сбой сервера.
    throw new AppError(
      400,
      "DOCUMENT_PARSE_FAILED",
      `Не удалось прочитать «${filename}»: ${error instanceof Error ? error.message : "неизвестная ошибка"}`,
      { file: ["Файл повреждён или защищён паролем"] },
    );
  }
}

// ---------------------------------------------------------------------------
// Чанкование
// ---------------------------------------------------------------------------

/**
 * Целевой размер фрагмента и перекрытие (задание: 1000–1500 символов, overlap 200).
 *
 * `TARGET` — предпочтительная длина, `MAX` — жёсткий предел: разрез ищется по
 * границе предложения в интервале между ними, поэтому фрагмент почти никогда не
 * равен ровно `TARGET`.
 */
export const CHUNK_TARGET_CHARS = 1200;
export const CHUNK_MAX_CHARS = 1500;
export const CHUNK_MIN_CHARS = 1000;
export const CHUNK_OVERLAP_CHARS = 200;

/**
 * Границы, по которым предпочтительно резать, от лучшей к худшей.
 *
 * Разрез посреди предложения ухудшает поиск: фрагмент теряет подлежащее или
 * отрицание, и его вектор перестаёт соответствовать смыслу. Поэтому в «хвосте»
 * допустимого интервала ищется конец абзаца, затем конец предложения, затем
 * пробел, и только если ничего не нашлось — режем по символу.
 */
const BOUNDARY_PATTERNS: readonly RegExp[] = [
  /\n\n/g,
  /(?<=[.!?…])\s/g,
  /(?<=[,;:])\s/g,
  /\s/g,
];

/** Последняя позиция границы в интервале `[from, to)` либо −1. */
function findBoundary(text: string, from: number, to: number): number {
  const window = text.slice(from, to);

  for (const pattern of BOUNDARY_PATTERNS) {
    let best = -1;
    // `lastIndex` сбрасывается: регулярные выражения объявлены с флагом `g` на
    // уровне модуля и сохраняют состояние между вызовами.
    pattern.lastIndex = 0;

    for (let match = pattern.exec(window); match !== null; match = pattern.exec(window)) {
      best = match.index + match[0].length;
      // Пустое совпадение сдвинуло бы `lastIndex` в бесконечный цикл.
      if (match[0].length === 0) pattern.lastIndex += 1;
    }

    if (best > 0) return from + best;
  }

  return -1;
}

export interface TextChunk {
  index: number;
  content: string;
}

/**
 * Режет текст на перекрывающиеся фрагменты.
 *
 * Перекрытие нужно потому, что ответ на вопрос может лежать на стыке: без него
 * фраза, начатая в конце одного фрагмента и завершённая в начале следующего, не
 * найдётся ни по одному из них.
 *
 * Возвращает пустой массив на пустом тексте — вызывающий трактует это как
 * документ без текстового слоя и отвечает `EMPTY_DOCUMENT`.
 */
export function chunkText(raw: string): TextChunk[] {
  const text = normaliseText(raw);
  if (text.length === 0) return [];

  const chunks: TextChunk[] = [];
  let start = 0;

  while (start < text.length) {
    const remaining = text.length - start;

    // Хвост целиком: отдельный фрагмент на 50 символов после разреза не несёт
    // самостоятельного смысла и только расходует вызовы эмбеддингов.
    if (remaining <= CHUNK_MAX_CHARS) {
      chunks.push({ index: chunks.length, content: text.slice(start).trim() });
      break;
    }

    const hardEnd = start + CHUNK_MAX_CHARS;
    const searchFrom = start + CHUNK_MIN_CHARS;
    const boundary = findBoundary(text, searchFrom, hardEnd);
    const end = boundary > 0 ? boundary : hardEnd;

    const content = text.slice(start, end).trim();
    if (content.length > 0) chunks.push({ index: chunks.length, content });

    // Следующий фрагмент начинается с перекрытием. `Math.max(..., start + 1)`
    // страхует от неподвижности курсора: при `end - overlap <= start` цикл стал
    // бы бесконечным и съел бы память процесса.
    start = Math.max(end - CHUNK_OVERLAP_CHARS, start + 1);
  }

  // Переиндексация: пустые фрагменты выше не добавлялись, поэтому исходный
  // счётчик мог оставить пропуски, а `chunk_index` участвует в UNIQUE-ограничении.
  return chunks.map((chunk, index) => ({ index, content: chunk.content }));
}
