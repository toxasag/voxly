import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { detectMimeFromBuffer, extensionToMime, mimeToExtension } from "../../../lib/mime.utils.js";

// ---------------------------------------------------------------------------
// Media Service (M5.3): прием и обработка вложений чата (аудио, фото, документы).
// ---------------------------------------------------------------------------

export interface StoredMediaFile {
  id: string;
  url: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

export class ChatMediaService {
  private uploadDir: string;
  private publicBaseUrl: string;

  constructor(options?: { uploadDir?: string; publicBaseUrl?: string }) {
    this.uploadDir = options?.uploadDir ?? path.resolve(process.cwd(), "uploads");
    this.publicBaseUrl = options?.publicBaseUrl ?? "/uploads";
  }

  private async ensureDir(): Promise<void> {
    await fs.mkdir(this.uploadDir, { recursive: true });
  }

  /**
   * Сохраняет бинарный буфер файла на диск и возвращает безопасный URL.
   */
  async storeBuffer(input: {
    buffer: Buffer;
    originalName: string;
    mimeType: string;
    tenantId: string;
  }): Promise<StoredMediaFile> {
    await this.ensureDir();

    const detectedMime = detectMimeFromBuffer(input.buffer);
    const normalizedInputMime = input.mimeType?.split(";")[0]?.trim().toLowerCase();
    const resolvedMime =
      !normalizedInputMime || normalizedInputMime === "application/octet-stream"
        ? detectedMime ?? extensionToMime(input.originalName)
        : detectedMime && detectedMime.startsWith("image/") && normalizedInputMime.startsWith("image/")
          ? detectedMime
          : input.mimeType;

    const id = crypto.randomUUID();
    const rawExt = path.extname(input.originalName);
    const mimeExt = mimeToExtension(resolvedMime);
    const ext =
      !rawExt || (rawExt.toLowerCase() === ".bin" && mimeExt !== ".bin")
        ? mimeExt
        : rawExt;

    const rawBase = path.basename(input.originalName, rawExt);
    let cleanBase = rawBase.replace(/[/\\?%*:|"<>]/g, "_").slice(0, 50);
    if (cleanBase === "file" && rawExt.toLowerCase() === ".bin" && ext !== ".bin") {
      cleanBase = resolvedMime.startsWith("image/")
        ? "photo"
        : resolvedMime.startsWith("video/")
          ? "video"
          : resolvedMime.startsWith("audio/")
            ? "audio"
            : "media";
    }

    const safeFilename = cleanBase
      ? `${input.tenantId}_${id}_${cleanBase}${ext}`
      : `${input.tenantId}_${id}${ext}`;
    const filePath = path.join(this.uploadDir, safeFilename);

    await fs.writeFile(filePath, input.buffer);

    const outputName =
      rawExt.toLowerCase() === ".bin" && ext !== ".bin"
        ? `${cleanBase}${ext}`
        : input.originalName;

    return {
      id,
      url: `${this.publicBaseUrl}/${safeFilename}`,
      filename: outputName,
      mimeType: resolvedMime,
      sizeBytes: input.buffer.length,
    };
  }
}
