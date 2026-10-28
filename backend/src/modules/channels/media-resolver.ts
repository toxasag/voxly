import fs from "node:fs/promises";
import path from "node:path";

export interface ResolvedOutboundMedia {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  category: "document" | "image" | "video" | "voice" | "audio";
}

/**
 * Определяет категорию медиа по mime-типу и имени файла.
 */
export function classifyMediaType(
  mimeType: string,
  filename?: string,
): "document" | "image" | "video" | "voice" | "audio" {
  const normMime = (mimeType || "").toLowerCase();
  const ext = filename ? path.extname(filename).toLowerCase() : "";

  if (
    normMime.includes("ogg") ||
    normMime.includes("opus") ||
    ext === ".ogg" ||
    ext === ".opus"
  ) {
    return "voice";
  }

  if (
    normMime.startsWith("audio/") ||
    [".mp3", ".m4a", ".wav", ".aac", ".flac"].includes(ext)
  ) {
    return "audio";
  }

  if (
    normMime.startsWith("video/") ||
    [".mp4", ".mov", ".avi", ".mkv", ".webm"].includes(ext)
  ) {
    return "video";
  }

  if (
    (normMime.startsWith("image/") && !normMime.includes("svg")) ||
    [".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(ext)
  ) {
    return "image";
  }

  return "document";
}

/**
 * Сопоставляет расширение файла со стандартным MIME-типом.
 */
export function extensionToMime(ext: string): string {
  const cleanExt = ext.toLowerCase().replace(/^\./, "");
  switch (cleanExt) {
    case "pdf":
      return "application/pdf";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "doc":
      return "application/msword";
    case "xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case "xls":
      return "application/vnd.ms-excel";
    case "txt":
      return "text/plain";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    case "mp4":
      return "video/mp4";
    case "mov":
      return "video/quicktime";
    case "mp3":
      return "audio/mpeg";
    case "ogg":
    case "opus":
      return "audio/ogg";
    case "m4a":
      return "audio/mp4";
    default:
      return "application/octet-stream";
  }
}

/**
 * Извлекает человекочитаемое имя файла из пути/URL.
 */
export function extractCleanFileName(attachment: string): string {
  const base = path.basename(attachment.split("?")[0] || "file.bin");
  // Если имя файла имеет формат tenantId_uuid_realName.ext, вырезаем префикс
  const stripped = base.replace(/^[0-9a-fA-F-]+_[0-9a-fA-F-]+_/, "");
  return decodeURIComponent(stripped || base);
}

/**
 * Проверяет, является ли текст сообщения реальной пользовательской подписью (caption),
 * а не служебным плейсхолдером или дублем имени файла.
 */
export function isMeaningfulCaption(
  text: string | undefined | null,
  filename?: string,
): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (
    !trimmed ||
    trimmed === "." ||
    trimmed === "[документ]" ||
    trimmed === "Вложение" ||
    trimmed === "Фотография" ||
    trimmed === "Видео" ||
    trimmed === "Аудио" ||
    trimmed === "Голосовое сообщение"
  ) {
    return false;
  }
  if (filename && (trimmed === filename.trim() || trimmed === path.basename(filename).trim())) {
    return false;
  }
  return true;
}

/**
 * Загружает бинарные данные вложения с диска или по сети.
 */
export async function resolveOutboundMedia(
  attachment: string,
  _tenantId?: string,
  hintMime?: string,
): Promise<ResolvedOutboundMedia | null> {
  if (!attachment || typeof attachment !== "string") return null;

  try {
    let buffer: Buffer | null = null;
    let originalName = extractCleanFileName(attachment);

    // 1. Попытка чтения с локального диска (папка uploads)
    const uploadsDir = path.resolve(process.cwd(), "uploads");
    const safeBase = path.basename(attachment.split("?")[0] || "");
    const localCandidate = path.join(uploadsDir, safeBase);

    try {
      const stat = await fs.stat(localCandidate);
      if (stat.isFile()) {
        buffer = await fs.readFile(localCandidate);
      }
    } catch {
      // Файл не найден по прямому пути в uploads, проверяем дальше
    }

    // 2. Если файл не найден локально, но передан URL (http/https)
    if (!buffer && (attachment.startsWith("http://") || attachment.startsWith("https://"))) {
      try {
        const res = await fetch(attachment);
        if (res.ok) {
          const ab = await res.arrayBuffer();
          buffer = Buffer.from(ab);
        }
      } catch {
        // Ошибка скачивания по сети
      }
    }

    if (!buffer || buffer.length === 0) {
      return null;
    }

    const ext = path.extname(originalName) || path.extname(safeBase);
    let mimeType = hintMime || (ext ? extensionToMime(ext) : "application/octet-stream");
    if (mimeType === "application/octet-stream" && ext) {
      mimeType = extensionToMime(ext);
    }

    const category = classifyMediaType(mimeType, originalName);

    return {
      buffer,
      filename: originalName,
      mimeType,
      category,
    };
  } catch {
    return null;
  }
}
