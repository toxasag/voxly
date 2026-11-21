/**
 * Преобразует пустую строку / null / undefined в null (для nullable-полей БД).
 */
export function nullIfBlank(value: string | null | undefined): string | null {
  if (value === undefined || value === null || value === "") return null;
  return value;
}
