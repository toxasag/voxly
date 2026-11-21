import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { extractText } from "../modules/ai/knowledge-text.js";

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Собирает минимальный ZIP из одной deflate-записи. */
function buildZip(name: string, content: Buffer): Buffer {
  const nameBuf = Buffer.from(name);
  const data = deflateRawSync(content);
  const crc = crc32(content);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(content.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(content.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt32LE(0, 42);

  const localPart = Buffer.concat([local, nameBuf, data]);
  const centralPart = Buffer.concat([central, nameBuf]);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralPart.length, 12);
  eocd.writeUInt32LE(localPart.length, 16);

  return Buffer.concat([localPart, centralPart, eocd]);
}

describe("extractText: защита XLSX от zip-бомбы", () => {
  it("обычная таблица читается", async () => {
    const sheet =
      '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Привет</t></is></c></row></sheetData></worksheet>';
    const zip = buildZip("xl/worksheets/sheet1.xml", Buffer.from(sheet));

    const text = await extractText({ filename: "ok.xlsx", extension: "xlsx", buffer: zip });
    expect(text).toContain("Привет");
  });

  it("запись, распаковывающаяся за лимит (40 МБ), отбрасывается, а не раздувает память", async () => {
    const bomb = Buffer.alloc(40 * 1024 * 1024, 0x41);
    const zip = buildZip("xl/worksheets/sheet1.xml", bomb);
    expect(zip.length).toBeLessThan(200 * 1024);

    const before = process.memoryUsage().rss;
    await expect(
      extractText({ filename: "bomb.xlsx", extension: "xlsx", buffer: zip }),
    ).rejects.toThrow();
    const growthMb = (process.memoryUsage().rss - before) / (1024 * 1024);

    expect(growthMb).toBeLessThan(35);
  });
});
