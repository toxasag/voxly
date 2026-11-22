export {
  buildCsvBuffer,
  buildXlsxBuffer,
  parseCsvText,
  parseXlsxBuffer,
  type ExportColumnDef,
} from "../../lib/spreadsheet-io.js";

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
