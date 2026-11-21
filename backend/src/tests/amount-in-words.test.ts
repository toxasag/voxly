import { describe, expect, it } from "vitest";

import { amountToWords } from "../modules/finance/amount-to-words.js";
import { numberToWordsRu } from "../modules/print-templates/print-templates.service.js";

describe("numberToWordsRu (печатные формы)", () => {
  it("900 рублей — «девятьсот», а не «девяносто»", () => {
    expect(numberToWordsRu(900)).toBe("Девятьсот рублей 00 копеек");
  });

  it("990 и 999 используют обе формы корректно", () => {
    expect(numberToWordsRu(990)).toBe("Девятьсот девяносто рублей 00 копеек");
    expect(numberToWordsRu(999)).toBe("Девятьсот девяносто девять рублей 00 копеек");
  });

  it("0 даёт «Ноль рублей»", () => {
    expect(numberToWordsRu(0)).toBe("Ноль рублей 00 копеек");
  });

  it("тысячи и миллионы склоняются верно", () => {
    expect(numberToWordsRu(1000)).toBe("Одна тысяча рублей 00 копеек");
    expect(numberToWordsRu(2000)).toBe("Две тысячи рублей 00 копеек");
    expect(numberToWordsRu(5000)).toBe("Пять тысяч рублей 00 копеек");
    expect(numberToWordsRu(1_000_000)).toBe("Один миллион рублей 00 копеек");
  });
});

describe("amountToWords (счета) и numberToWordsRu дают одинаковую сумму", () => {
  it.each([900, 1000, 2000, 5000, 12345, 999999])("совпадают для %i", (sum) => {
    expect(amountToWords(sum, 0)).toBe(numberToWordsRu(sum));
  });
});
