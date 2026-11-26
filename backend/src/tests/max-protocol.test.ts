import { describe, it, expect } from "vitest";
import {
  decodeMsgpack,
  encodeMsgpack,
  isFatalMaxAuthError,
  lz4CompressBlock,
  lz4DecompressBlock,
  MAX_HEADER_SIZE,
  MAX_PROTOCOL_VERSION,
  MaxCommand,
  MaxOpcode,
  packMaxFrame,
  toMaxIdValue,
  unpackMaxFrame,
} from "../modules/messaging/adapters/max/max-protocol.js";

describe("max-protocol (web.max.ru ver=10 binary framing)", () => {
  it("packs and unpacks small uncompressed ver=10 frames with exact header fields", () => {
    const frame = packMaxFrame({
      cmd: MaxCommand.REQUEST,
      seq: 42,
      opcode: MaxOpcode.PING,
      payload: { interactive: true },
    });

    expect(frame.readUInt8(0)).toBe(MAX_PROTOCOL_VERSION);
    expect(frame.readUInt8(1)).toBe(MaxCommand.REQUEST);
    expect(frame.readUInt16BE(2)).toBe(42);
    expect(frame.readUInt16BE(4)).toBe(MaxOpcode.PING);

    const decoded = unpackMaxFrame<{ interactive: boolean }>(frame);
    expect(decoded.ver).toBe(10);
    expect(decoded.cmd).toBe(MaxCommand.REQUEST);
    expect(decoded.seq).toBe(42);
    expect(decoded.opcode).toBe(MaxOpcode.PING);
    expect(decoded.lz4Factor).toBe(0);
    expect(decoded.payload.interactive).toBe(true);
  });

  it("preserves BigInt precision beyond MAX_SAFE_INTEGER using MessagePack ext type 1", () => {
    const bigMessageId = 117681574171602742n;
    const bigChatId = -7000123456789012345n;
    const clientSessionId = 1764148119123n;

    const frame = packMaxFrame({
      cmd: MaxCommand.REQUEST,
      seq: 7,
      opcode: MaxOpcode.MSG_SEND,
      payload: {
        chatId: bigChatId,
        cid: clientSessionId,
        message: {
          id: bigMessageId,
          text: "Тест точности int64",
        },
      },
      compress: false,
    });

    const decoded = unpackMaxFrame<{
      chatId: bigint;
      cid: number;
      message: { id: bigint; text: string };
    }>(frame);

    expect(typeof decoded.payload.chatId).toBe("bigint");
    expect(decoded.payload.chatId).toBe(bigChatId);
    expect(typeof decoded.payload.message.id).toBe("bigint");
    expect(decoded.payload.message.id).toBe(bigMessageId);
    expect(String(decoded.payload.message.id)).toBe("117681574171602742");
    expect(decoded.payload.cid).toBe(Number(clientSessionId));
    expect(decoded.payload.message.text).toBe("Тест точности int64");
  });

  it("compresses and decompresses LZ4 blocks when payload exceeds 32 bytes", () => {
    const repeatedText = "Привет от GETVOXLY CRM — длинное повторяющееся сообщение для сжатия LZ4! ".repeat(5);
    const payload = {
      chatId: 254468389,
      message: {
        cid: 1764148119123,
        text: repeatedText,
      },
    };

    const rawMsgpack = encodeMsgpack(payload);
    const lz4 = lz4CompressBlock(rawMsgpack);
    expect(lz4.length).toBeLessThan(rawMsgpack.length);

    const restoredMsgpack = lz4DecompressBlock(lz4);
    expect(restoredMsgpack.equals(rawMsgpack)).toBe(true);
    expect((decodeMsgpack(restoredMsgpack) as typeof payload).message.text).toBe(repeatedText);

    const frame = packMaxFrame({
      seq: 9,
      opcode: MaxOpcode.MSG_SEND,
      payload,
    });
    const decoded = unpackMaxFrame<typeof payload>(frame);
    expect(decoded.lz4Factor).toBeGreaterThan(0);
    expect(decoded.payload.message.text).toBe(repeatedText);
  });

  it("keeps at least 5 trailing literals in LZ4 blocks even when tail sync timestamps repeat", () => {
    const loginLikePayload = {
      token: "tok-" + "a".repeat(120),
      chatsCount: 40,
      interactive: true,
      chatsSync: 1795684065403,
      contactsSync: 1795684065403,
      presenceSync: 1795684065403,
      draftsSync: 1795684065403,
    };

    const raw = encodeMsgpack(loginLikePayload);
    const compressed = lz4CompressBlock(raw);
    expect(compressed.length).toBeLessThan(raw.length);
    // Последние 5 байт оригинала гарантированно присутствуют в конце сжатого блока как литералы
    expect(compressed.subarray(compressed.length - 5).equals(raw.subarray(raw.length - 5))).toBe(true);

    const frame = packMaxFrame({
      seq: 2,
      opcode: MaxOpcode.LOGIN,
      payload: loginLikePayload,
    });
    const decoded = unpackMaxFrame<typeof loginLikePayload>(frame);
    expect(decoded.payload.chatsSync).toBe(1795684065403);
    expect(decoded.payload.draftsSync).toBe(1795684065403);
  });

  it("rejects truncated frames cleanly", () => {
    expect(() => unpackMaxFrame(Buffer.from([0x0a, 0x00, 0x00]))).toThrow("MAX frame too short");

    const valid = packMaxFrame({ seq: 1, opcode: MaxOpcode.SESSION_INIT, payload: { mt: 1 } });
    const truncated = valid.subarray(0, valid.length - 2);
    expect(truncated.length).toBeGreaterThanOrEqual(MAX_HEADER_SIZE);
    expect(() => unpackMaxFrame(truncated)).toThrow("MAX frame truncated");
  });

  it("handles toMaxIdValue without precision loss and classifies fatal auth errors", () => {
    expect(toMaxIdValue("117681574171602742")).toBe(117681574171602742n);
    expect(toMaxIdValue("254468389")).toBe(254468389);
    expect(toMaxIdValue(117681574171602742n)).toBe(117681574171602742n);

    expect(isFatalMaxAuthError("login.token")).toBe(true);
    expect(isFatalMaxAuthError("Error: login.blocked by moderation")).toBe(true);
    expect(isFatalMaxAuthError("login.flood")).toBe(true);
    expect(isFatalMaxAuthError("user.not.found")).toBe(true);
    expect(isFatalMaxAuthError("MAX RPC timeout opcode=64")).toBe(false);
    expect(isFatalMaxAuthError("ECONNRESET")).toBe(false);
  });
});
