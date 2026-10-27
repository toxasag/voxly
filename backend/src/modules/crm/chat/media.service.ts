import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

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

    const id = crypto.randomUUID();
    const ext = path.extname(input.originalName) || this.mimeToExtension(input.mimeType);
    const safeFilename = `${input.tenantId}_${id}${ext}`;
    const filePath = path.join(this.uploadDir, safeFilename);

    await fs.writeFile(filePath, input.buffer);

    return {
      id,
      url: `${this.publicBaseUrl}/${safeFilename}`,
      filename: input.originalName,
      mimeType: input.mimeType,
      sizeBytes: input.buffer.length,
    };
  }

  private mimeToExtension(mime: string): string {
    switch (mime) {
      case "image/jpeg":
        return ".jpg";
      case "image/png":
        return ".png";
      case "image/webp":
        return ".webp";
      case "audio/ogg":
      case "audio/opus":
        return ".ogg";
      case "audio/mp3":
      case "audio/mpeg":
        return ".mp3";
      case "application/pdf":
        return ".pdf";
      case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      case "application/msword":
        return ".docx";
      case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      case "application/vnd.ms-excel":
        return ".xlsx";
      default:
        return ".bin";
    }
  }
}
