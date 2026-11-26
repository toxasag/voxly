import { guessMimeType } from "../../lib/mime.utils.js";
import { ChatMediaService } from "../crm/chat/media.service.js";

/**
 * Входное описание вложения MAX из нативного адаптера, бриджа или истории диалогов.
 */
export interface MaxAttachmentInput {
  type?: string;
  fileId?: string;
  fileName?: string;
  mimeType?: string;
  fileSize?: number;
}

export interface StoredMaxAttachment {
  index: number;
  attachment: MaxAttachmentInput;
  url: string;
  mimeType: string;
  fileName: string;
  textLabel: string;
}

/**
 * Генерирует стабильный external_message_id для каждого вложения внутри одного
 * много-вложенного сообщения MAX (первое вложение сохраняет базовый msgId для совместимости).
 */
export function maxAttachmentExternalId(baseMessageId: string, index: number): string {
  return index === 0 ? baseMessageId : `${baseMessageId}:att:${index}`;
}

/**
 * Возвращает человекочитаемый маркер для вложения MAX, когда отдельной подписи нет.
 */
export function maxAttachmentDefaultLabel(
  type?: string,
  fileName?: string,
  mimeType?: string,
): string {
  const cleanName = fileName?.trim();
  const normalizedType = type?.trim().toLowerCase();
  const isGenericFile = !cleanName || /^file\.bin$/i.test(cleanName);

  if (normalizedType === "photo" || mimeType?.startsWith("image/")) {
    return "[фото]";
  }
  if (normalizedType === "video" || mimeType?.startsWith("video/")) {
    return "[видео]";
  }
  if (normalizedType === "voice" || normalizedType === "audio" || mimeType?.startsWith("audio/")) {
    return "[голосовое]";
  }
  if (!isGenericFile && cleanName) {
    return `[файл: ${cleanName}]`;
  }
  return "[Вложение]";
}

/**
 * Формирует metadata для строки `deal_messages`, разделяя вложения одного сообщения MAX.
 */
export function buildMaxAttachmentMetadata(opts: {
  externalMessageId?: string | null;
  parentMessageId?: string | null;
  attachmentFileId?: string | null;
  isForwarded?: boolean;
  forwardFromUserId?: string | null;
  extra?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    ...(opts.extra ?? {}),
    ...(opts.externalMessageId ? { external_message_id: opts.externalMessageId } : {}),
    ...(opts.parentMessageId ? { external_parent_message_id: opts.parentMessageId } : {}),
    ...(opts.attachmentFileId ? { external_attachment_id: opts.attachmentFileId } : {}),
    ...(opts.isForwarded ? { is_forwarded: true } : {}),
    ...(opts.forwardFromUserId ? { forward_from_user_id: opts.forwardFromUserId } : {}),
  };
}

/**
 * Скачивает и сохраняет в `/uploads` все вложения MAX-сообщения без потери 2-го и последующих фото/файлов.
 */
export async function storeMaxMessageAttachments(opts: {
  tenantId: string;
  attachments: MaxAttachmentInput[];
  downloadMedia: (
    fileId: string,
  ) => Promise<{ ok: boolean; buffer?: Buffer; mimeType?: string; error?: string }>;
  log?: { warn: (obj: unknown, msg: string) => void };
}): Promise<StoredMaxAttachment[]> {
  const storedItems: StoredMaxAttachment[] = [];
  const mediaService = new ChatMediaService();

  for (const [index, att] of opts.attachments.entries()) {
    if (!att?.fileId) continue;
    try {
      const downloaded = await opts.downloadMedia(att.fileId);
      if (!downloaded.ok || !downloaded.buffer) {
        opts.log?.warn(
          { fileId: att.fileId, index, error: downloaded.error },
          "Failed to download MAX attachment",
        );
        continue;
      }

      const rawName = att.fileName?.trim() || "file.bin";
      const realMime = guessMimeType(rawName, downloaded.mimeType || att.mimeType);
      const saved = await mediaService.storeBuffer({
        buffer: downloaded.buffer,
        originalName: rawName,
        mimeType: realMime,
        tenantId: opts.tenantId,
      });

      storedItems.push({
        index,
        attachment: att,
        url: saved.url,
        mimeType: saved.mimeType,
        fileName: saved.filename,
        textLabel: maxAttachmentDefaultLabel(att.type, att.fileName, saved.mimeType),
      });
    } catch (err) {
      opts.log?.warn({ err, fileId: att.fileId, index }, "Exception downloading MAX attachment");
    }
  }

  return storedItems;
}
