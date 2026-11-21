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
 * Определяет MIME с приоритетом явно переданного (если он не `application/octet-stream`),
 * затем по расширению имени файла.
 */
export function guessMimeType(fileName: string, mime?: string): string {
  if (mime && mime !== "application/octet-stream") return mime;
  return extensionToMime(fileName, mime || "application/octet-stream");
}
