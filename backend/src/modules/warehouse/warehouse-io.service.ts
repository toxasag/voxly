import JSZip from "jszip";

/**
 * Escapes special XML characters.
 */
function escapeXml(unsafe: string | number | null | undefined): string {
  if (unsafe === null || unsafe === undefined) return "";
  const str = String(unsafe);
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Converts 0-indexed column number to Excel column letters (0 -> A, 25 -> Z, 26 -> AA).
 */
function colIndexToLetters(index: number): string {
  let temp = index;
  let letter = "";
  while (temp >= 0) {
    letter = String.fromCharCode((temp % 26) + 65) + letter;
    temp = Math.floor(temp / 26) - 1;
  }
  return letter;
}

/**
 * Converts Excel column letters to 0-indexed column number (A -> 0, Z -> 25, AA -> 26).
 */
function colLettersToIndex(letters: string): number {
  let index = 0;
  const upper = letters.toUpperCase();
  for (let i = 0; i < upper.length; i++) {
    index = index * 26 + (upper.charCodeAt(i) - 64);
  }
  return index - 1;
}

export interface ExportColumnDef<T> {
  header: string;
  key: (keyof T & string) | ((item: T) => string | number | null | undefined);
  width?: number;
}

/**
 * Generates an Excel XLSX buffer from an array of items.
 */
export async function buildXlsxBuffer<T>(
  columns: ExportColumnDef<T>[],
  items: T[],
  sheetName = "Номенклатура",
): Promise<Buffer> {
  const zip = new JSZip();

  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`,
  );

  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
  );

  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
  );

  zip.file(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`,
  );

  // Minimal styles for bold headers
  zip.file(
    "xl/styles.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2">
    <font><name val="Calibri"/><sz val="11"/></font>
    <font><b/><name val="Calibri"/><sz val="11"/></font>
  </fonts>
  <fills count="2">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
  </fills>
  <borders count="1">
    <border><left/><right/><top/><bottom/><diagonal/></border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="2">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
  </cellXfs>
</styleSheet>`,
  );

  // Sheet XML
  let sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <cols>`;

  for (let c = 0; c < columns.length; c++) {
    const w = columns[c]?.width ?? 18;
    sheetXml += `<col min="${c + 1}" max="${c + 1}" width="${w}" customWidth="1"/>`;
  }
  sheetXml += `</cols><sheetData>`;

  // Row 1: Header
  sheetXml += `<row r="1" customHeight="1" ht="24">`;
  for (let c = 0; c < columns.length; c++) {
    const cellRef = `${colIndexToLetters(c)}1`;
    const col = columns[c];
    const val = col ? col.header : "";
    sheetXml += `<c r="${cellRef}" t="inlineStr" s="1"><is><t>${escapeXml(val)}</t></is></c>`;
  }
  sheetXml += `</row>`;

  // Data rows
  for (let r = 0; r < items.length; r++) {
    const rowNum = r + 2;
    const item = items[r];
    if (!item) continue;
    sheetXml += `<row r="${rowNum}">`;

    for (let c = 0; c < columns.length; c++) {
      const col = columns[c];
      if (!col) continue;
      const cellRef = `${colIndexToLetters(c)}${rowNum}`;

      const rawVal =
        typeof col.key === "function"
          ? col.key(item)
          : (item as Record<string, unknown>)[col.key as string];

      if (rawVal === null || rawVal === undefined) {
        continue;
      }

      if (typeof rawVal === "number" && !isNaN(rawVal)) {
        sheetXml += `<c r="${cellRef}"><v>${rawVal}</v></c>`;
      } else {
        sheetXml += `<c r="${cellRef}" t="inlineStr"><is><t>${escapeXml(String(rawVal))}</t></is></c>`;
      }
    }
    sheetXml += `</row>`;
  }

  sheetXml += `</sheetData></worksheet>`;
  zip.file("xl/worksheets/sheet1.xml", sheetXml);

  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

/**
 * Generates a CSV buffer with UTF-8 BOM and RFC-4180 escaping.
 */
export function buildCsvBuffer<T>(
  columns: ExportColumnDef<T>[],
  items: T[],
  delimiter = ";",
): Buffer {
  const lines: string[] = [];

  function escapeCsvCell(val: unknown): string {
    if (val === null || val === undefined) return "";
    const str = String(val);
    if (
      str.includes(delimiter) ||
      str.includes('"') ||
      str.includes("\n") ||
      str.includes("\r")
    ) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  // Header line
  lines.push(columns.map((c) => escapeCsvCell(c.header)).join(delimiter));

  // Data lines
  for (const item of items) {
    const cells: string[] = [];
    for (const col of columns) {
      const rawVal =
        typeof col.key === "function"
          ? col.key(item)
          : (item as Record<string, unknown>)[col.key as string];
      cells.push(escapeCsvCell(rawVal));
    }
    lines.push(cells.join(delimiter));
  }

  // Prepend UTF-8 BOM so Excel opens Cyrillic properly
  const bom = "\uFEFF";
  const content = bom + lines.join("\r\n");
  return Buffer.from(content, "utf8");
}

/**
 * Parses CSV text into a 2D string array.
 */
export function parseCsvText(
  text: string,
  delimiter?: string,
): { rows: string[][]; detectedDelimiter: string } {
  // Strip BOM if present
  const clean = text.replace(/^\uFEFF/, "");

  // Auto-detect delimiter if not explicitly provided
  let delim = delimiter;
  if (!delim) {
    const firstLines = clean.slice(0, 2000);
    const semicolonCount = (firstLines.match(/;/g) || []).length;
    const commaCount = (firstLines.match(/,/g) || []).length;
    const tabCount = (firstLines.match(/\t/g) || []).length;

    if (semicolonCount >= commaCount && semicolonCount >= tabCount) {
      delim = ";";
    } else if (tabCount > commaCount) {
      delim = "\t";
    } else {
      delim = ",";
    }
  }

  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = "";
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    const next = clean[i + 1];

    if (inQuotes) {
      if (ch === '"') {
        if (next === '"') {
          currentCell += '"';
          i++; // skip escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        currentCell += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === delim) {
        currentRow.push(currentCell.trim());
        currentCell = "";
      } else if (ch === "\r") {
        if (next === "\n") i++;
        currentRow.push(currentCell.trim());
        if (currentRow.some((c) => c.length > 0)) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentCell = "";
      } else if (ch === "\n") {
        currentRow.push(currentCell.trim());
        if (currentRow.some((c) => c.length > 0)) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentCell = "";
      } else {
        currentCell += ch;
      }
    }
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell.trim());
    if (currentRow.some((c) => c.length > 0)) {
      rows.push(currentRow);
    }
  }

  return { rows, detectedDelimiter: delim };
}

/**
 * Parses an XLSX buffer into a 2D string array.
 */
export async function parseXlsxBuffer(buffer: Buffer): Promise<string[][]> {
  const zip = await JSZip.loadAsync(buffer);

  // 1. Shared Strings Table
  const sharedStrings: string[] = [];
  const sstFile = zip.file("xl/sharedStrings.xml");
  if (sstFile) {
    const sstXml = await sstFile.async("text");
    // Match each <si>...</si>
    const siMatches = sstXml.match(/<si>[\s\S]*?<\/si>/g) || [];
    for (const si of siMatches) {
      // Find all <t>...</t> tags inside <si>
      const tMatches = si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || [];
      const text = tMatches
        .map((t) => t.replace(/<[^>]+>/g, ""))
        .join("")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'");
      sharedStrings.push(text);
    }
  }

  // 2. Locate sheet1.xml (or first worksheet)
  let sheetFile = zip.file("xl/worksheets/sheet1.xml");
  if (!sheetFile) {
    // Find any sheet*.xml in xl/worksheets/
    const allSheets = zip.file(/xl\/worksheets\/sheet.*\.xml/);
    if (allSheets.length > 0 && allSheets[0]) {
      sheetFile = allSheets[0];
    }
  }

  if (!sheetFile) {
    throw new Error("Не найден лист данных в таблице Excel (worksheet)");
  }

  const sheetXml = await sheetFile.async("text");

  // 3. Parse <row r="N"> ... </row>
  const rowMatches = sheetXml.match(/<row[^>]*>[\s\S]*?<\/row>/g) || [];
  const rows: string[][] = [];

  for (const rowTag of rowMatches) {
    // Match all <c r="..." ...> ... </c>
    const cellMatches = rowTag.match(/<c[^>]*>[\s\S]*?<\/c>|<c[^>]*\/>/g) || [];
    const cellValues: Map<number, string> = new Map();
    let maxColIdx = -1;

    for (const cTag of cellMatches) {
      const rAttr = (cTag.match(/\br="([A-Z]+)(\d+)"/) || [])[1];
      if (!rAttr) continue;
      const colIdx = colLettersToIndex(rAttr);
      if (colIdx < 0) continue;
      maxColIdx = Math.max(maxColIdx, colIdx);

      const typeMatch = cTag.match(/\bt="([a-z]+)"/);
      const cellType = typeMatch ? typeMatch[1] : "";

      let val = "";

      if (cellType === "s") {
        // Shared string index
        const vMatch = (cTag.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        if (vMatch !== undefined) {
          const idx = parseInt(vMatch, 10);
          val = sharedStrings[idx] ?? "";
        }
      } else if (cellType === "inlineStr") {
        const tMatch = (cTag.match(/<t[^>]*>([\s\S]*?)<\/t>/) || [])[1];
        val = tMatch ?? "";
      } else {
        const vMatch = (cTag.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        val = vMatch ?? "";
      }

      val = val
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .trim();

      cellValues.set(colIdx, val);
    }

    if (maxColIdx >= 0) {
      const rowArr: string[] = [];
      for (let i = 0; i <= maxColIdx; i++) {
        rowArr.push(cellValues.get(i) ?? "");
      }
      if (rowArr.some((c) => c.length > 0)) {
        rows.push(rowArr);
      }
    }
  }

  return rows;
}

/**
 * Fuzzy matches a column header to one of the target GETVOXLY item fields.
 */
export function suggestFieldMapping(header: string): string | null {
  const h = header.trim().toLowerCase();

  // SKU / Article
  if (/^(арт|артикул|код|sku|article|item_code|номер\s*детали)$/i.test(h) || /артикул/i.test(h)) {
    return "sku";
  }

  // Name
  if (
    /^(наименование|название|товар|позиция|номенклатура|name|title|деталь)$/i.test(h) ||
    /наименование|название\s*товара|номенклатур/i.test(h)
  ) {
    return "name";
  }

  // Brand
  if (/^(бренд|производитель|марка|brand|manufacturer)$/i.test(h) || /бренд|производител/i.test(h)) {
    return "brand";
  }

  // Category
  if (/^(категория|группа|раздел|вид|тип|category|group)$/i.test(h) || /категори|групп/i.test(h)) {
    return "category";
  }

  // Unit
  if (
    /^(ед|единица|ед\.?\s*изм\.?|unit|uom)$/i.test(h) ||
    /единица\s*измерения|ед\.?\s*изм/i.test(h)
  ) {
    return "unit";
  }

  // Cost price (закупка)
  if (
    /^(закупка|себестоимость|закупочная|закуп|вход|cost|purchase_price|cost_price)$/i.test(h) ||
    /закуп|себестоимост/i.test(h)
  ) {
    return "cost_price";
  }

  // Retail price (розница)
  if (
    /^(розница|розничная|цена|стоимость|прайс|price|retail_price)$/i.test(h) ||
    /розничн|цена\s*продажи|цена\s*розниц|розниц/i.test(h)
  ) {
    return "retail_price";
  }

  // Min stock
  if (
    /^(мин|минимальный|мин\.?\s*остаток|порог|min_stock|min)$/i.test(h) ||
    /мин.*остаток|минимальн/i.test(h)
  ) {
    return "min_stock";
  }

  return null;
}
