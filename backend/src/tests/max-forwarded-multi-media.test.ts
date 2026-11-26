import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  detectMimeFromBuffer,
  detectMimeFromFileHeader,
  mimeToExtension,
} from "../lib/mime.utils.js";
import { ChatMediaService } from "../modules/crm/chat/media.service.js";
import {
  buildMaxAttachmentMetadata,
  maxAttachmentExternalId,
  storeMaxMessageAttachments,
} from "../modules/channels/max-attachments.js";
import { MaxTsAdapter } from "../modules/messaging/adapters/max/MaxTsAdapter.js";

const WEBP_HEADER = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0x22, 0x15, 0x01, 0x00,
  0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58,
]);

const PNG_HEADER = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d,
]);

const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

describe("MAX forwarded multi-photo & MIME detection", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        await fs.rm(dir, { recursive: true, force: true });
      }
    }
  });

  it("detectMimeFromBuffer & detectMimeFromFileHeader identify legacy .bin media bytes", async () => {
    expect(detectMimeFromBuffer(WEBP_HEADER)).toBe("image/webp");
    expect(detectMimeFromBuffer(PNG_HEADER)).toBe("image/png");
    expect(detectMimeFromBuffer(JPEG_HEADER)).toBe("image/jpeg");
    expect(mimeToExtension("image/webp")).toBe(".webp");

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "voxly-mime-"));
    tempDirs.push(dir);
    const binPath = path.join(dir, "legacy_file.bin");
    await fs.writeFile(binPath, WEBP_HEADER);

    await expect(detectMimeFromFileHeader(binPath)).resolves.toBe("image/webp");
  });

  it("ChatMediaService replaces placeholder file.bin with semantic .webp filename", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "voxly-media-"));
    tempDirs.push(dir);
    const media = new ChatMediaService({ uploadDir: dir, publicBaseUrl: "/uploads" });

    const stored = await media.storeBuffer({
      buffer: WEBP_HEADER,
      originalName: "file.bin",
      mimeType: "image/jpeg",
      tenantId: "b9ea05c5-a1af-4ecd-86a6-ad75db68fe58",
    });

    expect(stored.mimeType).toBe("image/webp");
    expect(stored.filename).toBe("photo.webp");
    expect(stored.url.endsWith("_photo.webp")).toBe(true);
  });

  it("MaxTsAdapter extracts every photo across forwarded and nested-forwarded MAX messages", () => {
    const adapter = new MaxTsAdapter();
    const fakeSession = {
      photoUrlCache: new Map<string, string>(),
    };

    const rawMsg = {
      id: "117681598465797942",
      text: "",
      link: {
        type: "FORWARD",
        message: {
          id: "117681597363613167",
          sender: 81343080,
          text: "",
          attaches: [
            { _type: "PHOTO", photoId: 60257021032, baseUrl: "https://i.oneme.ru/photo1" },
            { _type: "PHOTO", photoId: 60257021544, baseUrl: "https://i.oneme.ru/photo2" },
          ],
          link: {
            type: "FORWARD",
            message: {
              id: "117681590000000001",
              sender: 99001122,
              text: "Подпись из пересланного",
              attaches: [
                { _type: "PHOTO", photoId: 60257099999, baseUrl: "https://i.oneme.ru/photo3" },
              ],
            },
          },
        },
      },
    };

    const extractFn = (
      adapter as unknown as {
        extractMessageAttachments: (
          session: typeof fakeSession,
          raw: typeof rawMsg,
          chatId: string,
        ) => {
          text: string;
          attachments: Array<{ type: string; fileId?: string; url?: string }>;
          isForwarded: boolean;
          forwardFromUserId?: string;
        };
      }
    ).extractMessageAttachments.bind(adapter);

    const extracted = extractFn(fakeSession, rawMsg, "196946784");
    expect(extracted.isForwarded).toBe(true);
    expect(extracted.forwardFromUserId).toBe("81343080");
    expect(extracted.text).toBe("Подпись из пересланного");
    expect(extracted.attachments).toHaveLength(3);
    expect(extracted.attachments.map((a) => a.fileId)).toEqual([
      "max:196946784:117681598465797942:photo:60257021032",
      "max:196946784:117681598465797942:photo:60257021544",
      "max:196946784:117681598465797942:photo:60257099999",
    ]);
    expect(fakeSession.photoUrlCache.get("max:196946784:117681598465797942:photo:60257021544")).toBe(
      "https://i.oneme.ru/photo2",
    );
  });

  it("storeMaxMessageAttachments stores all attachments with distinct external_message_id keys", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "voxly-multi-"));
    tempDirs.push(dir);

    const origCwd = process.cwd();
    process.chdir(dir);
    try {
      const stored = await storeMaxMessageAttachments({
        tenantId: "b9ea05c5-a1af-4ecd-86a6-ad75db68fe58",
        attachments: [
          { type: "photo", fileId: "max:196946784:117681598465797942:photo:60257021032" },
          { type: "photo", fileId: "max:196946784:117681598465797942:photo:60257021544" },
        ],
        downloadMedia: async (fileId) => ({
          ok: true,
          buffer: fileId.endsWith("60257021032") ? WEBP_HEADER : PNG_HEADER,
          mimeType: "application/octet-stream",
        }),
      });

      expect(stored).toHaveLength(2);
      expect(stored[0]?.mimeType).toBe("image/webp");
      expect(stored[0]?.url.endsWith("_photo.webp")).toBe(true);
      expect(stored[1]?.mimeType).toBe("image/png");
      expect(stored[1]?.url.endsWith("_photo.png")).toBe(true);

      expect(maxAttachmentExternalId("117681598465797942", 0)).toBe("117681598465797942");
      expect(maxAttachmentExternalId("117681598465797942", 1)).toBe("117681598465797942:att:1");
      expect(
        buildMaxAttachmentMetadata({
          externalMessageId: maxAttachmentExternalId("117681598465797942", 1),
          parentMessageId: "117681598465797942",
          attachmentFileId: stored[1]?.attachment.fileId,
          isForwarded: true,
          forwardFromUserId: "81343080",
        }),
      ).toEqual({
        external_message_id: "117681598465797942:att:1",
        external_parent_message_id: "117681598465797942",
        external_attachment_id: "max:196946784:117681598465797942:photo:60257021544",
        is_forwarded: true,
        forward_from_user_id: "81343080",
      });
    } finally {
      process.chdir(origCwd);
    }
  });
});
