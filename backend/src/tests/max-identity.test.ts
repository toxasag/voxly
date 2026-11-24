import { describe, it, expect } from "vitest";
import { extractMaxIdentity, normalizeMaxPhone, parseMaxVCard } from "../modules/channels/max-identity.js";

describe("MAX Identity & Phone Extraction", () => {
  it("normalizes Russian 8-prefixed phones and strips owner phone (INC-113)", () => {
    expect(normalizeMaxPhone("8 (915) 094-69-44")).toBe("+79150946944");
    expect(normalizeMaxPhone(79855014040)).toBe("+79855014040");
    expect(normalizeMaxPhone("+79918829870", "+7 991 882-98-70")).toBeUndefined();
    expect(normalizeMaxPhone("12345")).toBeUndefined();
    expect(normalizeMaxPhone("+79999999999")).toBeUndefined();
  });

  it("extracts firstName, lastName from MAX names[] preferring ONEME over CUSTOM", () => {
    const res = extractMaxIdentity({
      names: [
        { name: "Клиентчик", type: "CUSTOM" },
        { firstName: "Николай", lastName: "Смирнов", type: "ONEME" },
      ],
      phone: "79165553322",
    });

    expect(res.firstName).toBe("Николай");
    expect(res.lastName).toBe("Смирнов");
    expect(res.senderName).toBe("Николай Смирнов");
    expect(res.phone).toBe("+79165553322");
  });

  it("splits fullName or two-word firstName when lastName is missing", () => {
    const res = extractMaxIdentity({
      firstName: "Антон Иванов",
      lastName: null,
      senderName: "123456789",
    });

    expect(res.firstName).toBe("Антон");
    expect(res.lastName).toBe("Иванов");
    expect(res.senderName).toBe("Антон Иванов");
  });

  it("extracts phone and FIO from CONTACT attachment and vcfBody", () => {
    const vcard = parseMaxVCard("BEGIN:VCARD\nN:Петрова;Елена;;;\nTEL;TYPE=CELL:+7 903 555-82-34\nEND:VCARD");
    expect(vcard.firstName).toBe("Елена");
    expect(vcard.lastName).toBe("Петрова");
    expect(vcard.phone).toBe("+7 903 555-82-34");

    const res = extractMaxIdentity({
      senderName: "399484253",
      attachments: [
        {
          type: "CONTACT",
          vcfBody: "BEGIN:VCARD\nFN:Елена Петрова\nTEL:+7 903 555-82-34\nEND:VCARD",
        },
      ],
    });

    expect(res.firstName).toBe("Елена");
    expect(res.lastName).toBe("Петрова");
    expect(res.phone).toBe("+79035558234");
  });

  it("rejects banned/bot/numeric names and falls back safely", () => {
    const res = extractMaxIdentity({
      firstName: "GetVoxly",
      senderName: "399484253",
    });

    expect(res.firstName).toBeUndefined();
    expect(res.lastName).toBeUndefined();
    expect(res.senderName).toBe("Клиент MAX");
  });
});
