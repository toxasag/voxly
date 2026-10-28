import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import {
  classifyMediaType,
  extensionToMime,
  extractCleanFileName,
  isMeaningfulCaption,
  resolveOutboundMedia,
} from "../modules/channels/media-resolver.js";

describe("media-resolver", () => {
  it("classifyMediaType классифицирует все категории файлов", () => {
    // 1. Документы
    expect(classifyMediaType("application/pdf", "test.pdf")).toBe("document");
    expect(classifyMediaType("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "test.docx")).toBe("document");
    expect(classifyMediaType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "test.xlsx")).toBe("document");
    expect(classifyMediaType("text/plain", "test.txt")).toBe("document");

    // 2. Изображения
    expect(classifyMediaType("image/png", "test.png")).toBe("image");
    expect(classifyMediaType("image/jpeg", "test.jpg")).toBe("image");
    expect(classifyMediaType("image/webp", "test.webp")).toBe("image");

    // 3. Видео
    expect(classifyMediaType("video/mp4", "test.mp4")).toBe("video");
    expect(classifyMediaType("video/quicktime", "test.mov")).toBe("video");

    // 4. Аудио / Voice
    expect(classifyMediaType("audio/mpeg", "test.mp3")).toBe("audio");
    expect(classifyMediaType("audio/mp4", "test.m4a")).toBe("audio");
    expect(classifyMediaType("audio/ogg", "test.ogg")).toBe("voice");
    expect(classifyMediaType("audio/opus", "test.opus")).toBe("voice");
  });

  it("extensionToMime возвращает точные типы по расширению", () => {
    expect(extensionToMime("pdf")).toBe("application/pdf");
    expect(extensionToMime(".docx")).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(extensionToMime(".xlsx")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(extensionToMime(".txt")).toBe("text/plain");
    expect(extensionToMime(".png")).toBe("image/png");
    expect(extensionToMime(".jpg")).toBe("image/jpeg");
    expect(extensionToMime(".webp")).toBe("image/webp");
    expect(extensionToMime(".mp4")).toBe("video/mp4");
    expect(extensionToMime(".mov")).toBe("video/quicktime");
    expect(extensionToMime(".mp3")).toBe("audio/mpeg");
    expect(extensionToMime(".ogg")).toBe("audio/ogg");
  });

  it("extractCleanFileName очищает префиксы tenantId_uuid_", () => {
    expect(
      extractCleanFileName("/uploads/c0000000-0000-0000-0000-000000000001_839bfe27-dd8c-48ed-a7c4-ba7f1853a4bd_Счёт.pdf"),
    ).toBe("Счёт.pdf");
    expect(
      extractCleanFileName("c0000000-0000-0000-0000-000000000001_839bfe27-dd8c-48ed-a7c4-ba7f1853a4bd_test.docx"),
    ).toBe("test.docx");
    expect(extractCleanFileName("my_file.xlsx")).toBe("my_file.xlsx");
  });

  it("isMeaningfulCaption распознает реальный текст от служебных меток", () => {
    expect(isMeaningfulCaption("", "doc.pdf")).toBe(false);
    expect(isMeaningfulCaption(".", "doc.pdf")).toBe(false);
    expect(isMeaningfulCaption("[документ]", "doc.pdf")).toBe(false);
    expect(isMeaningfulCaption("Вложение", "doc.pdf")).toBe(false);
    expect(isMeaningfulCaption("doc.pdf", "doc.pdf")).toBe(false);
    expect(isMeaningfulCaption("Тагир, добрый день! Отправляю счёт", "doc.pdf")).toBe(true);
  });

  it("resolveOutboundMedia читает файл с диска", async () => {
    const uploadsDir = path.resolve(process.cwd(), "uploads");
    await fs.mkdir(uploadsDir, { recursive: true });

    const testFilename = `test_tenant_uuid_${Date.now()}_sample.pdf`;
    const testPath = path.join(uploadsDir, testFilename);
    const testBuffer = Buffer.from("%PDF-1.4 test document content");
    await fs.writeFile(testPath, testBuffer);

    try {
      const resolved = await resolveOutboundMedia(`/uploads/${testFilename}`);
      expect(resolved).not.toBeNull();
      expect(resolved?.filename).toBe("sample.pdf");
      expect(resolved?.mimeType).toBe("application/pdf");
      expect(resolved?.category).toBe("document");
      expect(resolved?.buffer.toString()).toBe(testBuffer.toString());
    } finally {
      await fs.unlink(testPath).catch(() => {});
    }
  });
});
