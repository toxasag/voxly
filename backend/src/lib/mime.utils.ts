import fs from "node:fs/promises";

/**
 * Единая таблица расширений файлов → MIME-типов для загрузок, вложений и мессенджеров.
 * Ключи без ведущей точки, в нижнем регистре.
 */
export const EXTENSION_TO_MIME: Readonly<Record<string, string>> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  bmp: "image/bmp",
  heic: "image/heic",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  csv: "text/csv",
  txt: "text/plain",
  zip: "application/zip",
};

const MIME_TO_EXTENSION: Readonly<Record<string, string>> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/svg+xml": ".svg",
  "image/bmp": ".bmp",
  "image/heic": ".heic",
  "audio/ogg": ".ogg",
  "audio/opus": ".ogg",
  "audio/mp3": ".mp3",
  "audio/mpeg": ".mp3",
  "audio/mp4": ".m4a",
  "audio/m4a": ".m4a",
  "audio/x-m4a": ".m4a",
  "audio/wav": ".wav",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "video/webm": ".webm",
  "text/plain": ".txt",
  "text/csv": ".csv",
  "application/pdf": ".pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/msword": ".docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/vnd.ms-excel": ".xlsx",
  "application/zip": ".zip",
};

/**
 * Определяет MIME по расширению (с точкой или без) либо имени файла.
 */
export function extensionToMime(
  extOrFileName: string,
  fallback = "application/octet-stream",
): string {
  const cleaned = extOrFileName.trim().toLowerCase();
  if (!cleaned) return fallback;
  const dotIdx = cleaned.lastIndexOf(".");
  const ext = dotIdx >= 0 ? cleaned.slice(dotIdx + 1) : cleaned;
  return EXTENSION_TO_MIME[ext] ?? fallback;
}

/**
 * Возвращает каноническое расширение с точкой для известного MIME-типа.
 */
export function mimeToExtension(mime: string): string {
  const normalized = mime.split(";")[0]?.trim().toLowerCase() ?? "";
  return MIME_TO_EXTENSION[normalized] ?? ".bin";
}

/**
 * Определяет MIME по сигнатуре первых байтов буфера (для legacy `.bin` и медиа без расширения).
 */
export function detectMimeFromBuffer(buffer: Buffer): string | null {
  if (buffer.length < 4) return null;

  // WebP: RIFF....WEBP
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return "image/webp";
  }

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "image/png";
  }

  // GIF87a / GIF89a
  if (
    buffer.length >= 6 &&
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x38 &&
    (buffer[4] === 0x37 || buffer[4] === 0x39) &&
    buffer[5] === 0x61
  ) {
    return "image/gif";
  }

  // PDF: %PDF
  if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
    return "application/pdf";
  }

  // OGG / Opus: OggS
  if (buffer[0] === 0x4f && buffer[1] === 0x67 && buffer[2] === 0x67 && buffer[3] === 0x53) {
    return "audio/ogg";
  }

  // ISO BMFF (ftyp at offset 4): MP4 / MOV / M4A
  if (
    buffer.length >= 12 &&
    buffer[4] === 0x66 &&
    buffer[5] === 0x74 &&
    buffer[6] === 0x79 &&
    buffer[7] === 0x70
  ) {
    const brand = buffer.subarray(8, 12).toString("ascii");
    if (brand === "M4A " || brand === "M4B ") return "audio/mp4";
    if (brand === "qt  ") return "video/quicktime";
    return "video/mp4";
  }

  // MP3: ID3 or frame sync
  const b0 = buffer[0] ?? 0;
  const b1 = buffer[1] ?? 0;
  const b2 = buffer[2] ?? 0;
  if ((b0 === 0x49 && b1 === 0x44 && b2 === 0x33) || (b0 === 0xff && (b1 & 0xe0) === 0xe0)) {
    return "audio/mpeg";
  }

  return null;
}

/**
 * Читает заголовок файла с диска (до 32 байт) и возвращает MIME по сигнатуре.
 */
export async function detectMimeFromFileHeader(filePath: string): Promise<string | null> {
  const handle = await fs.open(filePath, "r");
  try {
    const header = Buffer.alloc(32);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (bytesRead <= 0) return null;
    return detectMimeFromBuffer(header.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}

/**
 * Определяет MIME с приоритетом явно переданного (если он не `application/octet-stream`),
 * затем по расширению имени файла.
 */
export function guessMimeType(fileName: string, mime?: string): string {
  if (mime && mime !== "application/octet-stream") return mime;
  return extensionToMime(fileName, mime || "application/octet-stream");
}
