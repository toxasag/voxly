/**
 * Преобразует пустую строку / null / undefined в null (для nullable-полей БД).
 */
export function nullIfBlank(value: string | null | undefined): string | null {
  if (value === undefined || value === null || value === "") return null;
  return value;
}

/**
 * Русское склонение числительных: forms = [1 штука, 2 штуки, 5 штук].
 */
export function pluralRu(
  count: number,
  forms: readonly [string, string, string],
): string {
  const mod100 = Math.abs(count) % 100;
  if (mod100 > 10 && mod100 < 20) return forms[2];
  const mod10 = mod100 % 10;
  if (mod10 === 1) return forms[0];
  if (mod10 >= 2 && mod10 <= 4) return forms[1];
  return forms[2];
}

/**
 * Экранирует спецсимволы LIKE/ILIKE (`\`, `%`, `_`) при использовании `ESCAPE '\'`.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

/**
 * Разбивает поисковый запрос по пробельным символам на уникальные непустые токены
 * для многословного `AND`-поиска в любом порядке слов.
 */
export function tokenizeSearchQuery(
  query: string | undefined | null,
  maxTokens = 10,
): string[] {
  if (!query) return [];
  const tokens = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 0);
  return [...new Set(tokens)].slice(0, maxTokens);
}
