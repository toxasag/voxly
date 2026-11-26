// ---------------------------------------------------------------------------
// Бинарный протокол web.max.ru (ver = 10):
//   - 10-байтовый big-endian header: ver(1), cmd(1), seq(2), opcode(2),
//     flags/lz4Factor(1), payloadLen(3)
//   - MessagePack с поддержкой BigInt через extension type 1
//   - LZ4 block compression для payload > 32 байт (+ поддержка Zstd flag 0xFF)
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import * as zlib from "node:zlib";

export const MAX_WS_ENDPOINT = "wss://api.oneme.ru/websocket";
export const MAX_ORIGIN = "https://web.max.ru";
export const MAX_APP_VERSION = "26.11.10";
export const MAX_DEFAULT_HEADER_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";

export const FATAL_MAX_AUTH_ERRORS: ReadonlySet<string> = new Set([
  "login.token",
  "login.blocked",
  "login.flood",
  "user.not.found",
  "FAIL_LOGIN_TOKEN",
  "FAIL_LOGOUT_ALL",
]);

export interface MaxUserAgentPayload {
  deviceType: "WEB";
  pushDeviceType: "WEBPUSH";
  appVersion: string;
  osVersion: string;
  deviceName: string;
  headerUserAgent: string;
  isPwa: boolean;
  screen: string;
  locale: string;
  deviceLocale: string;
  timezone: string;
}

export function buildMaxUserAgent(saved?: Record<string, unknown> | null): MaxUserAgentPayload {
  return {
    deviceType: "WEB",
    pushDeviceType: "WEBPUSH",
    appVersion: MAX_APP_VERSION,
    osVersion: typeof saved?.osVersion === "string" && saved.osVersion ? saved.osVersion : "Linux",
    deviceName: typeof saved?.deviceName === "string" && saved.deviceName ? saved.deviceName : "Chrome",
    headerUserAgent:
      typeof saved?.headerUserAgent === "string" && saved.headerUserAgent
        ? saved.headerUserAgent
        : MAX_DEFAULT_HEADER_UA,
    isPwa: typeof saved?.isPwa === "boolean" ? saved.isPwa : false,
    screen: typeof saved?.screen === "string" && saved.screen ? saved.screen : "1080x1920 1.0x",
    locale: typeof saved?.locale === "string" && saved.locale ? saved.locale : "ru",
    deviceLocale:
      typeof saved?.deviceLocale === "string" && saved.deviceLocale ? saved.deviceLocale : "ru",
    timezone:
      typeof saved?.timezone === "string" && saved.timezone ? saved.timezone : "Europe/Moscow",
  };
}

export function normalizeUuidDeviceId(existing?: string | null): string {
  const clean = (existing ?? "").trim();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean)) {
    return clean;
  }
  return randomUUID();
}

export function isFatalMaxAuthError(codeOrMessage?: string | null): boolean {
  if (!codeOrMessage) return false;
  const trimmed = codeOrMessage.trim();
  if (FATAL_MAX_AUTH_ERRORS.has(trimmed)) return true;
  const lower = trimmed.toLowerCase();
  for (const code of FATAL_MAX_AUTH_ERRORS) {
    if (lower.includes(code.toLowerCase())) return true;
  }
  return false;
}

type WebSocketWithHeadersCtor = new (
  url: string,
  init?: { headers?: Record<string, string> },
) => WebSocket;

export function openMaxWebSocket(endpoint = MAX_WS_ENDPOINT): WebSocket {
  const Ctor = globalThis.WebSocket as unknown as WebSocketWithHeadersCtor | undefined;
  if (typeof Ctor !== "function") {
    throw new Error("Global WebSocket is unavailable in this Node.js runtime");
  }
  const ws = new Ctor(endpoint, {
    headers: {
      Origin: MAX_ORIGIN,
      "User-Agent": MAX_DEFAULT_HEADER_UA,
    },
  });
  ws.binaryType = "arraybuffer";
  return ws;
}

export const MAX_PROTOCOL_VERSION = 10;
export const MAX_HEADER_SIZE = 10;
export const MAX_LZ4_THRESHOLD_BYTES = 32;
export const MAX_DECOMPRESSED_BYTES = 5 * 1024 * 1024;
export const MAX_WRAPPED_EXT_TYPE = 1;

export enum MaxCommand {
  REQUEST = 0,
  ACK = 1,
  RETRY = 2,
  ERROR = 3,
}

export enum MaxOpcode {
  PING = 1,
  DEBUG = 2,
  RECONNECT = 3,
  SESSION_INIT = 6,
  LOGIN2 = 8,
  PROFILE = 16,
  AUTH_REQUEST = 17,
  AUTH = 18,
  LOGIN = 19,
  LOGOUT = 20,
  SYNC = 21,
  CONFIG = 22,
  AUTH_CONFIRM = 23,
  CONTACT_INFO = 32,
  CONTACT_ADD = 33,
  CONTACT_UPDATE = 34,
  CONTACT_LIST = 36,
  CONTACT_INFO_BY_PHONE = 46,
  CHAT_INFO = 48,
  CHAT_HISTORY = 49,
  CHAT_MARK = 50,
  CHATS_LIST = 53,
  MSG_SEND = 64,
  MSG_DELETE = 66,
  MSG_EDIT = 67,
  MSG_GET = 71,
  PHOTO_UPLOAD = 80,
  VIDEO_UPLOAD = 82,
  VIDEO_PLAY = 83,
  FILE_UPLOAD = 87,
  FILE_DOWNLOAD = 88,
  SESSIONS_INFO = 96,
  SESSIONS_CLOSE = 97,
  AUTH_CREATE_TRACK = 112,
  AUTH_CHECK_PASSWORD = 113,
  AUTH_LOGIN_CHECK_PASSWORD = 115,
  NOTIF_MESSAGE = 128,
  NOTIF_TYPING = 129,
  NOTIF_MARK = 130,
  NOTIF_CHAT = 135,
  NOTIF_ATTACH = 136,
  NOTIF_CALL_START = 137,
  GET_QR = 288,
  GET_QR_STATUS = 289,
  AUTH_QR_APPROVE = 290,
  LOGIN_BY_QR = 291,
  AUTH_PHONE_CALL_STATUS = 294,
}

export interface MaxFrame<T = Record<string, unknown>> {
  ver: number;
  cmd: number;
  seq: number;
  opcode: number;
  lz4Factor: number;
  payloadLen: number;
  payload: T;
}

// ---------------------------------------------------------------------------
// MessagePack Encoder / Decoder (supports BigInt via ext type 1)
// ---------------------------------------------------------------------------

function writeBigIntAsInt64Msgpack(value: bigint): Buffer {
  const out = Buffer.allocUnsafe(9);
  out.writeUInt8(0xd3, 0);
  out.writeBigInt64BE(value, 1);
  return out;
}

function encodeLengthPrefixedBytes(
  out: number[],
  bytes: Uint8Array,
  fixMask: number | null,
  fixMax: number,
  tag8: number,
  tag16: number,
  tag32: number,
): void {
  const len = bytes.length;
  if (fixMask !== null && len <= fixMax) {
    out.push(fixMask | len);
  } else if (len <= 0xff) {
    out.push(tag8, len);
  } else if (len <= 0xffff) {
    out.push(tag16, (len >>> 8) & 0xff, len & 0xff);
  } else {
    out.push(
      tag32,
      (len >>> 24) & 0xff,
      (len >>> 16) & 0xff,
      (len >>> 8) & 0xff,
      len & 0xff,
    );
  }
  for (let i = 0; i < len; i++) {
    out.push(bytes[i]!);
  }
}

function encodeValue(out: number[], value: unknown): void {
  if (value === null || value === undefined) {
    out.push(0xc0);
    return;
  }

  if (typeof value === "boolean") {
    out.push(value ? 0xc3 : 0xc2);
    return;
  }

  if (typeof value === "bigint") {
    const inner = writeBigIntAsInt64Msgpack(value);
    // ext8 (0xc7), length = 9, type = 1
    out.push(0xc7, inner.length, MAX_WRAPPED_EXT_TYPE);
    for (let i = 0; i < inner.length; i++) {
      out.push(inner[i]!);
    }
    return;
  }

  if (typeof value === "number") {
    if (Number.isInteger(value) && Number.isSafeInteger(value)) {
      if (value >= 0) {
        if (value <= 0x7f) {
          out.push(value);
        } else if (value <= 0xff) {
          out.push(0xcc, value);
        } else if (value <= 0xffff) {
          out.push(0xcd, (value >>> 8) & 0xff, value & 0xff);
        } else if (value <= 0xffffffff) {
          out.push(
            0xce,
            (value >>> 24) & 0xff,
            (value >>> 16) & 0xff,
            (value >>> 8) & 0xff,
            value & 0xff,
          );
        } else {
          const buf = Buffer.allocUnsafe(9);
          buf.writeUInt8(0xcf, 0);
          buf.writeBigUInt64BE(BigInt(value), 1);
          for (let i = 0; i < 9; i++) out.push(buf[i]!);
        }
      } else if (value >= -32) {
        out.push(value & 0xff);
      } else if (value >= -128) {
        out.push(0xd0, value & 0xff);
      } else if (value >= -32768) {
        out.push(0xd1, (value >> 8) & 0xff, value & 0xff);
      } else if (value >= -2147483648) {
        out.push(
          0xd2,
          (value >> 24) & 0xff,
          (value >> 16) & 0xff,
          (value >> 8) & 0xff,
          value & 0xff,
        );
      } else {
        const buf = Buffer.allocUnsafe(9);
        buf.writeUInt8(0xd3, 0);
        buf.writeBigInt64BE(BigInt(value), 1);
        for (let i = 0; i < 9; i++) out.push(buf[i]!);
      }
      return;
    }

    // Float64
    const buf = Buffer.allocUnsafe(9);
    buf.writeUInt8(0xcb, 0);
    buf.writeDoubleBE(value, 1);
    for (let i = 0; i < 9; i++) out.push(buf[i]!);
    return;
  }

  if (typeof value === "string") {
    const bytes = Buffer.from(value, "utf8");
    encodeLengthPrefixedBytes(out, bytes, 0xa0, 31, 0xd9, 0xda, 0xdb);
    return;
  }

  if (value instanceof Uint8Array) {
    encodeLengthPrefixedBytes(out, value, null, -1, 0xc4, 0xc5, 0xc6);
    return;
  }

  if (Array.isArray(value)) {
    const len = value.length;
    if (len <= 15) {
      out.push(0x90 | len);
    } else if (len <= 0xffff) {
      out.push(0xdc, (len >>> 8) & 0xff, len & 0xff);
    } else {
      out.push(
        0xdd,
        (len >>> 24) & 0xff,
        (len >>> 16) & 0xff,
        (len >>> 8) & 0xff,
        len & 0xff,
      );
    }
    for (let i = 0; i < len; i++) {
      encodeValue(out, value[i]);
    }
    return;
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(
      ([, v]) => v !== undefined,
    );
    const len = entries.length;
    if (len <= 15) {
      out.push(0x80 | len);
    } else if (len <= 0xffff) {
      out.push(0xde, (len >>> 8) & 0xff, len & 0xff);
    } else {
      out.push(
        0xdf,
        (len >>> 24) & 0xff,
        (len >>> 16) & 0xff,
        (len >>> 8) & 0xff,
        len & 0xff,
      );
    }
    for (const [k, v] of entries) {
      encodeValue(out, k);
      encodeValue(out, v);
    }
    return;
  }

  out.push(0xc0);
}

export function encodeMsgpack(value: unknown): Buffer {
  if (value === undefined || value === null) return Buffer.alloc(0);
  const out: number[] = [];
  encodeValue(out, value);
  return Buffer.from(out);
}

class MsgpackReader {
  private pos = 0;

  constructor(private readonly buf: Buffer) {}

  private readUInt8(): number {
    if (this.pos >= this.buf.length) throw new Error("MessagePack unexpected EOF");
    return this.buf.readUInt8(this.pos++);
  }

  private readUInt16BE(): number {
    if (this.pos + 2 > this.buf.length) throw new Error("MessagePack unexpected EOF");
    const v = this.buf.readUInt16BE(this.pos);
    this.pos += 2;
    return v;
  }

  private readUInt32BE(): number {
    if (this.pos + 4 > this.buf.length) throw new Error("MessagePack unexpected EOF");
    const v = this.buf.readUInt32BE(this.pos);
    this.pos += 4;
    return v;
  }

  private readBytes(len: number): Buffer {
    if (this.pos + len > this.buf.length) throw new Error("MessagePack unexpected EOF");
    const slice = this.buf.subarray(this.pos, this.pos + len);
    this.pos += len;
    return slice;
  }

  private toSafeIntOrBigInt(val: bigint): number | bigint {
    if (val >= BigInt(Number.MIN_SAFE_INTEGER) && val <= BigInt(Number.MAX_SAFE_INTEGER)) {
      return Number(val);
    }
    return val;
  }

  private readExt(len: number): unknown {
    const extType = this.buf.readInt8(this.pos++);
    const payload = this.readBytes(len);
    if (extType === MAX_WRAPPED_EXT_TYPE && payload.length > 0) {
      return new MsgpackReader(payload).read();
    }
    return payload;
  }

  private readArray(len: number): unknown[] {
    const arr: unknown[] = new Array(len);
    for (let i = 0; i < len; i++) {
      arr[i] = this.read();
    }
    return arr;
  }

  private readMap(len: number): Record<string, unknown> {
    const obj: Record<string, unknown> = {};
    for (let i = 0; i < len; i++) {
      const rawKey = this.read();
      const key =
        rawKey instanceof Uint8Array
          ? Buffer.from(rawKey).toString("utf8")
          : String(rawKey);
      obj[key] = this.read();
    }
    return obj;
  }

  read(): unknown {
    const byte = this.readUInt8();

    if (byte <= 0x7f) return byte;
    if (byte >= 0xe0) return byte - 256;
    if (byte >= 0x80 && byte <= 0x8f) return this.readMap(byte & 0x0f);
    if (byte >= 0x90 && byte <= 0x9f) return this.readArray(byte & 0x0f);
    if (byte >= 0xa0 && byte <= 0xbf) return this.readBytes(byte & 0x1f).toString("utf8");

    switch (byte) {
      case 0xc0:
        return null;
      case 0xc2:
        return false;
      case 0xc3:
        return true;
      case 0xc4:
        return this.readBytes(this.readUInt8());
      case 0xc5:
        return this.readBytes(this.readUInt16BE());
      case 0xc6:
        return this.readBytes(this.readUInt32BE());
      case 0xc7:
        return this.readExt(this.readUInt8());
      case 0xc8:
        return this.readExt(this.readUInt16BE());
      case 0xc9:
        return this.readExt(this.readUInt32BE());
      case 0xca: {
        const v = this.buf.readFloatBE(this.pos);
        this.pos += 4;
        return v;
      }
      case 0xcb: {
        const v = this.buf.readDoubleBE(this.pos);
        this.pos += 8;
        return v;
      }
      case 0xcc:
        return this.readUInt8();
      case 0xcd:
        return this.readUInt16BE();
      case 0xce:
        return this.readUInt32BE();
      case 0xcf: {
        const v = this.buf.readBigUInt64BE(this.pos);
        this.pos += 8;
        return this.toSafeIntOrBigInt(v);
      }
      case 0xd0: {
        const v = this.buf.readInt8(this.pos);
        this.pos += 1;
        return v;
      }
      case 0xd1: {
        const v = this.buf.readInt16BE(this.pos);
        this.pos += 2;
        return v;
      }
      case 0xd2: {
        const v = this.buf.readInt32BE(this.pos);
        this.pos += 4;
        return v;
      }
      case 0xd3: {
        const v = this.buf.readBigInt64BE(this.pos);
        this.pos += 8;
        return this.toSafeIntOrBigInt(v);
      }
      case 0xd4:
        return this.readExt(1);
      case 0xd5:
        return this.readExt(2);
      case 0xd6:
        return this.readExt(4);
      case 0xd7:
        return this.readExt(8);
      case 0xd8:
        return this.readExt(16);
      case 0xd9:
        return this.readBytes(this.readUInt8()).toString("utf8");
      case 0xda:
        return this.readBytes(this.readUInt16BE()).toString("utf8");
      case 0xdb:
        return this.readBytes(this.readUInt32BE()).toString("utf8");
      case 0xdc:
        return this.readArray(this.readUInt16BE());
      case 0xdd:
        return this.readArray(this.readUInt32BE());
      case 0xde:
        return this.readMap(this.readUInt16BE());
      case 0xdf:
        return this.readMap(this.readUInt32BE());
      default:
        throw new Error(`Unsupported MessagePack prefix byte: 0x${byte.toString(16)}`);
    }
  }
}

export function decodeMsgpack(buf: Buffer): unknown {
  if (buf.length === 0) return {};
  return new MsgpackReader(buf).read();
}

// ---------------------------------------------------------------------------
// LZ4 Block Compression / Decompression
// ---------------------------------------------------------------------------

function writeExtraLength(dst: number[], value: number): void {
  let rem = value;
  while (rem >= 255) {
    dst.push(255);
    rem -= 255;
  }
  dst.push(rem);
}

export function lz4CompressBlock(src: Buffer): Buffer {
  // По спецификации LZ4 (LZ4_decompress_safe) последние 5 байт блока обязаны быть литералами
  // (LASTLITERALS = 5), а поиск совпадений останавливается за MFLIMIT = 12 байт до конца.
  const dst: number[] = [];
  let pos = 0;
  let anchor = 0;
  const searchLimit = Math.max(0, src.length - 12);
  const matchEndLimit = Math.max(0, src.length - 5);

  while (pos < searchLimit) {
    let matchOffset = 0;
    let matchLen = 0;

    if (pos + 4 <= matchEndLimit) {
      const minI = Math.max(0, pos - 65535);
      for (let i = pos - 1; i >= minI; i--) {
        if (
          src[i] === src[pos] &&
          src[i + 1] === src[pos + 1] &&
          src[i + 2] === src[pos + 2] &&
          src[i + 3] === src[pos + 3]
        ) {
          let len = 4;
          const maxLen = matchEndLimit - pos;
          while (len < maxLen && src[i + len] === src[pos + len]) {
            len++;
          }
          if (len > matchLen) {
            matchLen = len;
            matchOffset = pos - i;
            if (len >= 64) break;
          }
        }
      }
    }

    if (matchLen < 4) {
      pos++;
      continue;
    }

    const litLen = pos - anchor;
    const matchExtra = matchLen - 4;
    const token =
      ((litLen >= 15 ? 15 : litLen) << 4) |
      (matchExtra >= 15 ? 15 : matchExtra);
    dst.push(token);

    if (litLen >= 15) {
      writeExtraLength(dst, litLen - 15);
    }
    for (let i = anchor; i < pos; i++) {
      dst.push(src[i]!);
    }

    dst.push(matchOffset & 0xff, (matchOffset >> 8) & 0xff);
    if (matchExtra >= 15) {
      writeExtraLength(dst, matchExtra - 15);
    }

    pos += matchLen;
    anchor = pos;
  }

  // Last literals sequence (всегда присутствует, минимум 5 байт при src.length >= 5)
  const trailingLitLen = src.length - anchor;
  const token = (trailingLitLen >= 15 ? 15 : trailingLitLen) << 4;
  dst.push(token);
  if (trailingLitLen >= 15) {
    writeExtraLength(dst, trailingLitLen - 15);
  }
  for (let i = anchor; i < src.length; i++) {
    dst.push(src[i]!);
  }

  return Buffer.from(dst);
}

export function lz4DecompressBlock(src: Buffer, maxOutput = MAX_DECOMPRESSED_BYTES): Buffer {
  const dst: number[] = [];
  let pos = 0;

  while (pos < src.length) {
    const token = src[pos++]!;
    let litLen = token >> 4;
    if (litLen === 15) {
      while (pos < src.length) {
        const b = src[pos++]!;
        litLen += b;
        if (b !== 255) break;
      }
    }

    if (litLen > 0) {
      if (pos + litLen > src.length) {
        throw new Error("LZ4: literal length out of bounds");
      }
      for (let i = 0; i < litLen; i++) {
        dst.push(src[pos + i]!);
      }
      pos += litLen;
      if (dst.length > maxOutput) {
        throw new Error("LZ4: output exceeds max size");
      }
    }

    if (pos >= src.length) break;
    if (pos + 2 > src.length) {
      throw new Error("LZ4: incomplete match offset");
    }
    const offset = src[pos]! | (src[pos + 1]! << 8);
    pos += 2;
    if (offset === 0) {
      throw new Error("LZ4: zero match offset");
    }

    let matchLen = (token & 0x0f) + 4;
    if ((token & 0x0f) === 0x0f) {
      while (pos < src.length) {
        const b = src[pos++]!;
        matchLen += b;
        if (b !== 255) break;
      }
    }

    const matchPos = dst.length - offset;
    if (matchPos < 0) {
      throw new Error("LZ4: match offset out of bounds");
    }
    for (let i = 0; i < matchLen; i++) {
      dst.push(dst[matchPos + (i % offset)]!);
    }
    if (dst.length > maxOutput) {
      throw new Error("LZ4: output exceeds max size");
    }
  }

  return Buffer.from(dst);
}

// ---------------------------------------------------------------------------
// 10-byte Framing (ver = 10)
// ---------------------------------------------------------------------------

export function packMaxFrame(opts: {
  ver?: number;
  cmd?: number;
  seq: number;
  opcode: number;
  payload?: unknown;
  compress?: boolean;
}): Buffer {
  const ver = opts.ver ?? MAX_PROTOCOL_VERSION;
  const cmd = opts.cmd ?? MaxCommand.REQUEST;
  let body = opts.payload !== undefined && opts.payload !== null
    ? encodeMsgpack(opts.payload)
    : Buffer.alloc(0);

  let lz4Factor = 0;
  if (opts.compress !== false && body.length > MAX_LZ4_THRESHOLD_BYTES) {
    const compressed = lz4CompressBlock(body);
    if (compressed.length > 0 && compressed.length < body.length) {
      lz4Factor = Math.max(1, Math.min(127, Math.floor(body.length / compressed.length) + 1));
      body = compressed;
    }
  }

  const header = Buffer.allocUnsafe(MAX_HEADER_SIZE);
  header.writeUInt8(ver & 0xff, 0);
  header.writeUInt8(cmd & 0xff, 1);
  header.writeUInt16BE(opts.seq & 0xffff, 2);
  header.writeUInt16BE(opts.opcode & 0xffff, 4);
  const packedLen = ((lz4Factor & 0xff) << 24) | (body.length & 0x00ffffff);
  header.writeUInt32BE(packedLen >>> 0, 6);

  return Buffer.concat([header, body]);
}

export function unpackMaxFrame<T = Record<string, unknown>>(raw: Buffer | ArrayBuffer | Uint8Array): MaxFrame<T> {
  const buf = raw instanceof Buffer ? raw : Buffer.from(raw instanceof ArrayBuffer ? new Uint8Array(raw) : raw);
  if (buf.length < MAX_HEADER_SIZE) {
    throw new Error(`MAX frame too short: ${buf.length} bytes`);
  }

  const ver = buf.readUInt8(0);
  const cmd = buf.readUInt8(1);
  const seq = buf.readUInt16BE(2);
  const opcode = buf.readUInt16BE(4);
  const packedLen = buf.readUInt32BE(6);
  const lz4Factor = (packedLen >>> 24) & 0xff;
  const payloadLen = packedLen & 0x00ffffff;

  if (buf.length < MAX_HEADER_SIZE + payloadLen) {
    throw new Error(`MAX frame truncated: expected ${MAX_HEADER_SIZE + payloadLen}, got ${buf.length}`);
  }

  let body = buf.subarray(MAX_HEADER_SIZE, MAX_HEADER_SIZE + payloadLen);
  if (body.length > 0) {
    if (lz4Factor === 0xff) {
      const zstdFn = (zlib as { zstdDecompressSync?: (b: Buffer) => Buffer }).zstdDecompressSync;
      if (typeof zstdFn !== "function") {
        throw new Error("Zstd decompression is not supported in this Node.js runtime");
      }
      body = Buffer.from(zstdFn(body));
    } else if (lz4Factor > 0x7f) {
      throw new Error(`MAX invalid compression factor: ${lz4Factor}`);
    } else if (lz4Factor > 0) {
      body = lz4DecompressBlock(body);
    }
  }

  const decoded = body.length > 0 ? decodeMsgpack(body) : {};
  const payload = (decoded && typeof decoded === "object" ? decoded : {}) as T;

  return { ver, cmd, seq, opcode, lz4Factor, payloadLen, payload };
}

/** Преобразует числовой/строковый идентификатор MAX в BigInt, если он превышает MAX_SAFE_INTEGER. */
export function toMaxIdValue(id: string | number | bigint): number | bigint {
  if (typeof id === "bigint") {
    return id >= BigInt(Number.MIN_SAFE_INTEGER) && id <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(id)
      : id;
  }
  if (typeof id === "number") return id;
  const trimmed = id.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    throw new Error(`Invalid numeric MAX id: ${id}`);
  }
  const big = BigInt(trimmed);
  if (big >= BigInt(Number.MIN_SAFE_INTEGER) && big <= BigInt(Number.MAX_SAFE_INTEGER)) {
    return Number(big);
  }
  return big;
}
