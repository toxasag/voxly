import { describe, expect, it } from "vitest";
import {
  extractPhoneNumber,
  analyzePhoneInText,
  validatePhoneCandidate,
} from "../modules/crm/channel-identity.js";

describe("Phone Validation & Incomplete Phone Detection", () => {
  describe("validatePhoneCandidate — Unit Tests", () => {
    it("бракует 10-значные номера с 7 или 8 как неполные (too_short)", () => {
      const res1 = validatePhoneCandidate("7911111111");
      expect(res1.isValid).toBe(false);
      expect(res1.normalized).toBeNull();
      expect(res1.issue).toBe("too_short");

      const res2 = validatePhoneCandidate("8911111111");
      expect(res2.isValid).toBe(false);
      expect(res2.normalized).toBeNull();
      expect(res2.issue).toBe("too_short");

      const res3 = validatePhoneCandidate("+7911111111");
      expect(res3.isValid).toBe(false);
      expect(res3.normalized).toBeNull();
      expect(res3.issue).toBe("too_short");
    });

    it("бракует номера с избыточными цифрами как too_long", () => {
      const res1 = validatePhoneCandidate("+7999123456789");
      expect(res1.isValid).toBe(false);
      expect(res1.normalized).toBeNull();
      expect(res1.issue).toBe("too_long");

      const res2 = validatePhoneCandidate("8999123456789");
      expect(res2.isValid).toBe(false);
      expect(res2.normalized).toBeNull();
      expect(res2.issue).toBe("too_long");

      const res3 = validatePhoneCandidate("791111111111");
      expect(res3.isValid).toBe(false);
      expect(res3.normalized).toBeNull();
      expect(res3.issue).toBe("too_long");
    });

    it("бракует фиктивные и тестовые номера (+79111111111, все одинаковые цифры, последовательности) как fake_number", () => {
      const res1 = validatePhoneCandidate("+79111111111");
      expect(res1.isValid).toBe(false);
      expect(res1.normalized).toBeNull();
      expect(res1.issue).toBe("fake_number");

      const res2 = validatePhoneCandidate("89111111111");
      expect(res2.isValid).toBe(false);
      expect(res2.normalized).toBeNull();
      expect(res2.issue).toBe("fake_number");

      const res3 = validatePhoneCandidate("+7 (911) 111-11-11");
      expect(res3.isValid).toBe(false);
      expect(res3.normalized).toBeNull();
      expect(res3.issue).toBe("fake_number");

      const res4 = validatePhoneCandidate("11111111111");
      expect(res4.isValid).toBe(false);
      expect(res4.normalized).toBeNull();
      expect(res4.issue).toBe("fake_number");

      const res5 = validatePhoneCandidate("+79999999999");
      expect(res5.isValid).toBe(false);
      expect(res5.normalized).toBeNull();
      expect(res5.issue).toBe("fake_number");

      const res6 = validatePhoneCandidate("+79123456789");
      expect(res6.isValid).toBe(false);
      expect(res6.normalized).toBeNull();
      expect(res6.issue).toBe("fake_number");
    });

    it("принимает полные 11-значные номера РФ и нормализует в E.164 (+7XXXXXXXXXX)", () => {
      const res1 = validatePhoneCandidate("+79150946944");
      expect(res1.isValid).toBe(true);
      expect(res1.normalized).toBe("+79150946944");

      const res2 = validatePhoneCandidate("89150946944");
      expect(res2.isValid).toBe(true);
      expect(res2.normalized).toBe("+79150946944");

      const res3 = validatePhoneCandidate("79150946944");
      expect(res3.isValid).toBe(true);
      expect(res3.normalized).toBe("+79150946944");

      const res4 = validatePhoneCandidate("+7 (926) 555-43-21");
      expect(res4.isValid).toBe(true);
      expect(res4.normalized).toBe("+79265554321");

      const res5 = validatePhoneCandidate("8-915-094-69-44");
      expect(res5.isValid).toBe(true);
      expect(res5.normalized).toBe("+79150946944");
    });

    it("принимает 10-значные мобильные РФ, начинающиеся с 9", () => {
      const res1 = validatePhoneCandidate("9150946944");
      expect(res1.isValid).toBe(true);
      expect(res1.normalized).toBe("+79150946944");

      const res2 = validatePhoneCandidate("(915) 094-69-44");
      expect(res2.isValid).toBe(true);
      expect(res2.normalized).toBe("+79150946944");
    });

    it("принимает международные номера с + (E.164 от 10 до 15 цифр)", () => {
      const res1 = validatePhoneCandidate("+375291234567");
      expect(res1.isValid).toBe(true);
      expect(res1.normalized).toBe("+375291234567");

      const res2 = validatePhoneCandidate("+998901234567");
      expect(res2.isValid).toBe(true);
      expect(res2.normalized).toBe("+998901234567");
    });
  });

  describe("analyzePhoneInText & extractPhoneNumber", () => {
    it("распознает кейс из инцидента: ввод неполного номера 7911111111", () => {
      const analysis = analyzePhoneInText("7911111111");
      expect(analysis.hasAttempt).toBe(true);
      expect(analysis.isValid).toBe(false);
      expect(analysis.phone).toBeNull();
      expect(analysis.issue).toBe("too_short");

      expect(extractPhoneNumber("7911111111")).toBeNull();
    });

    it("распознает попытку ввода номера внутри смешанного текста", () => {
      const analysis1 = analyzePhoneInText("мой номер 7911111111, жду звонка");
      expect(analysis1.hasAttempt).toBe(true);
      expect(analysis1.isValid).toBe(false);
      expect(analysis1.phone).toBeNull();
      expect(analysis1.issue).toBe("too_short");

      const analysis2 = analyzePhoneInText("мой номер +7999123456789 позвоните");
      expect(analysis2.hasAttempt).toBe(true);
      expect(analysis2.isValid).toBe(false);
      expect(analysis2.phone).toBeNull();
      expect(analysis2.issue).toBe("too_long");
    });

    it("извлекает валидный номер из смешанного текста и бракует фиктивные", () => {
      const res = extractPhoneNumber("Алексей, мой номер +7 (926) 555-43-21, звоните после 18:00");
      expect(res).toBe("+79265554321");

      const res2 = extractPhoneNumber("звоните 89150946944");
      expect(res2).toBe("+79150946944");

      const fakeRes = extractPhoneNumber("мой номер 89111111111");
      expect(fakeRes).toBeNull();

      const fakeAnalysis = analyzePhoneInText("мой номер +7 (911) 111-11-11 перезвоните");
      expect(fakeAnalysis.hasAttempt).toBe(true);
      expect(fakeAnalysis.isValid).toBe(false);
      expect(fakeAnalysis.issue).toBe("fake_number");
    });

    it("не путает суммы долга, кредитов и статей с номерами телефонов", () => {
      const analysis1 = analyzePhoneInText("У меня долг 300 000 рублей по кредитной карте");
      expect(analysis1.hasAttempt).toBe(false);
      expect(analysis1.isValid).toBe(false);
      expect(analysis1.phone).toBeNull();
      expect(extractPhoneNumber("У меня долг 300 000 рублей по кредитной карте")).toBeNull();

      const analysis2 = analyzePhoneInText("100 тыс");
      expect(analysis2.hasAttempt).toBe(false);
      expect(analysis2.isValid).toBe(false);
      expect(extractPhoneNumber("100 тыс")).toBeNull();

      const analysis3 = analyzePhoneInText("статья 127 фз о банкротстве");
      expect(analysis3.hasAttempt).toBe(false);
      expect(analysis3.isValid).toBe(false);
      expect(extractPhoneNumber("статья 127 фз о банкротстве")).toBeNull();
    });
  });
});
