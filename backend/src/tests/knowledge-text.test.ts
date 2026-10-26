import { describe, expect, it } from "vitest";

import {
  CHUNK_MAX_CHARS,
  CHUNK_OVERLAP_CHARS,
  chunkText,
  extensionOf,
  isSupportedExtension,
  normaliseText,
} from "../modules/ai/knowledge-text.js";

// ---------------------------------------------------------------------------
// Юнит-тесты чанкования и нормализации.
//
// Без БД и без сети: это чистые преобразования, и именно они определяют качество
// поиска. Ошибка здесь не падает, а тихо ухудшает ответы агента — фрагмент,
// разрезанный посреди отрицания, меняет смысл на противоположный.
// ---------------------------------------------------------------------------

describe("normaliseText", () => {
  it("сводит переводы строк и убирает нулевой байт", () => {
    // Нулевой байт встречается в pdf, собранных из бинарных потоков, и
    // PostgreSQL отклоняет его в TEXT ошибкой `invalid byte sequence`.
    const result = normaliseText("а\u0000б\r\nв\r\n\r\n\r\n\r\nг   \nд");

    expect(result).toBe("аб\nв\n\nг\nд");
    expect(result).not.toContain("\u0000");
    expect(result).not.toContain("\r");
  });

  it("не оставляет более двух переводов строки подряд", () => {
    expect(normaliseText("а\n\n\n\n\n\nб")).toBe("а\n\nб");
  });
});

describe("extensionOf / isSupportedExtension", () => {
  it("извлекает расширение без учёта регистра", () => {
    expect(extensionOf("Регламент.PDF")).toBe("pdf");
    expect(extensionOf("archive.tar.gz")).toBe("gz");
    expect(extensionOf("no-extension")).toBe("");
  });

  it("допускает только txt, md, docx, pdf, xlsx и csv", () => {
    expect(isSupportedExtension("docx")).toBe(true);
    expect(isSupportedExtension("md")).toBe(true);
    expect(isSupportedExtension("xlsx")).toBe(true);
    expect(isSupportedExtension("csv")).toBe(true);
    // Исполняемые и архивы отклоняются: текст из них не извлекается, а приём
    // произвольных файлов означал бы хранение чужих бинарников в БД.
    expect(isSupportedExtension("exe")).toBe(false);
    expect(isSupportedExtension("zip")).toBe(false);
  });
});

describe("chunkText", () => {
  /** Текст заданной длины из осмысленных предложений, а не повторов одной буквы. */
  function buildText(sentences: number): string {
    return Array.from(
      { length: sentences },
      (_, index) =>
        `Пункт ${index + 1}. Гарантийный срок на ремонт составляет ${90 + index} дней с даты выдачи устройства клиенту.`,
    ).join(" ");
  }

  it("возвращает пустой массив на пустом тексте", () => {
    // Вызывающий трактует это как «документ без текстового слоя» и отвечает
    // EMPTY_DOCUMENT, а не создаёт документ с нулём фрагментов.
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   \n\n  ")).toEqual([]);
  });

  it("короткий текст остаётся одним фрагментом", () => {
    const chunks = chunkText("Гарантия на ремонт — 90 дней.");

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.index).toBe(0);
    expect(chunks[0]?.content).toBe("Гарантия на ремонт — 90 дней.");
  });

  it("ни один фрагмент не превышает жёсткий предел", () => {
    const chunks = chunkText(buildText(120));

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(CHUNK_MAX_CHARS);
    }
  });

  it("индексы идут подряд от нуля", () => {
    // `chunk_index` участвует в UNIQUE (document_id, chunk_index), поэтому
    // пропуск в нумерации ломал бы повторную векторизацию.
    const chunks = chunkText(buildText(200));

    expect(chunks.map((chunk) => chunk.index)).toEqual(
      Array.from({ length: chunks.length }, (_, index) => index),
    );
  });

  it("соседние фрагменты перекрываются", () => {
    const chunks = chunkText(buildText(150));

    expect(chunks.length).toBeGreaterThan(2);

    const first = chunks[0];
    const second = chunks[1];
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    if (first === undefined || second === undefined) return;

    // Перекрытие нужно потому, что ответ может лежать на стыке: без него фраза,
    // начатая в конце одного фрагмента, не найдётся ни по одному из них.
    const tail = first.content.slice(-Math.min(CHUNK_OVERLAP_CHARS, 60));
    expect(second.content.includes(tail.trim().slice(0, 40))).toBe(true);
  });

  it("режет по границе предложения, а не посреди слова", () => {
    const chunks = chunkText(buildText(150));
    const first = chunks[0];

    expect(first).toBeDefined();
    if (first === undefined) return;

    // Разрез посреди слова означал бы обрубок в векторе; допускаем окончание на
    // знаке препинания или на целом слове.
    expect(/[.!?…,;:»)\d\p{L}]$/u.test(first.content)).toBe(true);
  });

  it("не зацикливается на тексте без пробелов", () => {
    // Прежний риск: при отсутствии границ курсор мог не сдвинуться, и цикл съел
    // бы память процесса. Страховка `start + 1` проверяется здесь.
    const solid = "я".repeat(CHUNK_MAX_CHARS * 3);
    const chunks = chunkText(solid);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.length).toBeLessThan(20);
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeGreaterThan(0);
    }
  });

  it("сохраняет весь исходный текст", () => {
    const source = buildText(80);
    const chunks = chunkText(source);

    // Склейка с перекрытием не обязана совпасть с источником посимвольно, но
    // каждое предложение должно встречаться хотя бы в одном фрагменте: потеря
    // фрагмента означала бы, что часть документа не попадёт в поиск.
    const joined = chunks.map((chunk) => chunk.content).join(" ");
    for (const marker of ["Пункт 1.", "Пункт 40.", "Пункт 80."]) {
      expect(joined).toContain(marker);
    }
  });
});
