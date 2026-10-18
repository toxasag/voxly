"use client";

import { useEffect, useRef, useState } from "react";
import { Phone, Plus, Star, Trash2 } from "lucide-react";
import type { CountryCode } from "libphonenumber-js";
import type { ContactPhoneInput } from "@/schemas/contact.schema";
import {
  COUNTRY_OPTIONS_SORTED,
  DEFAULT_COUNTRY,
  callingCodeFor,
  formatAsYouType,
  isValidPhone,
  nationalPart,
  parsePhoneInput,
} from "@/lib/utils/phone";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Список телефонов контакта.
//
// Поведение перенесено из `MultiItemFieldInput` + `PhonesFieldInput` в Twenty:
//  - первый номер — основной, у него значок; у остальных есть кнопка «сделать
//    основным» (у них `getShowSetAsPrimaryButton = index > 0`);
//  - код страны выбирается отдельным селектором, номер вводится без него;
//  - номер форматируется по ходу ввода, а наружу отдаётся в E.164.
//
// Строки живут в собственном состоянии, а не выводятся из пропа `value`.
// Первая версия рендерила прямо из `value`, отфильтровывая пустые номера перед
// вызовом `onChange` — и из-за этого кнопка «Добавить номер» не работала вовсе:
// новая пустая строка отбрасывалась фильтром, `value` не менялся, строка не
// появлялась. По той же причине выбор страны в пустой строке откатывался.
// Наружу по-прежнему уходят только заполненные номера, но рендер от этого не
// зависит.
//
// Ключ строки — стабильный идентификатор, а не индекс: `commit` меняет и длину
// списка, и порядок («сделать основным»), и черновик ввода, привязанный к
// позиции, после удаления номера показывался бы в чужой строке.
//
// Селектор кода — обычный <select> с кодом и названием страны: список из ~250
// стран без поиска в кастомном дропдауне листается хуже, чем нативным контролом,
// у которого поиск по первым буквам уже есть.
// ---------------------------------------------------------------------------

interface PhonesInputProps {
  value: ContactPhoneInput[];
  onChange: (next: ContactPhoneInput[]) => void;
  /** Сообщение об ошибке от схемы или сервера. */
  error?: string;
  idPrefix?: string;
}

/** Строка формы: значение плюс идентификатор для ключа и черновика. */
interface PhoneRow {
  id: string;
  number: string;
  countryCode: CountryCode;
  callingCode: string;
  /** Текст в поле ввода: национальная часть, отформатированная по ходу набора. */
  draft: string;
}

let rowCounter = 0;

function nextRowId(): string {
  rowCounter += 1;
  return `phone-${rowCounter}`;
}

function emptyRow(): PhoneRow {
  return {
    id: nextRowId(),
    number: "",
    countryCode: DEFAULT_COUNTRY,
    callingCode: callingCodeFor(DEFAULT_COUNTRY),
    draft: "",
  };
}

function toRow(phone: ContactPhoneInput): PhoneRow {
  const countryCode = phone.country_code !== undefined && phone.country_code !== ""
    ? (phone.country_code as CountryCode)
    : DEFAULT_COUNTRY;

  return {
    id: nextRowId(),
    number: phone.number,
    countryCode,
    callingCode: phone.calling_code ?? callingCodeFor(countryCode),
    draft: formatAsYouType(nationalPart(phone.number, countryCode), countryCode),
  };
}

function toRows(phones: ContactPhoneInput[]): PhoneRow[] {
  return phones.length === 0 ? [emptyRow()] : phones.map(toRow);
}

function toValue(rows: PhoneRow[]): ContactPhoneInput[] {
  return rows
    .filter((row) => row.number !== "")
    .map((row) => ({
      number: row.number,
      country_code: row.countryCode,
      calling_code: row.callingCode,
    }));
}

/** Сравнение по номерам: `value` пересобирается при каждом рендере родителя. */
function sameNumbers(rows: PhoneRow[], phones: ContactPhoneInput[]): boolean {
  const filled = rows.filter((row) => row.number !== "");
  if (filled.length !== phones.length) return false;

  return filled.every((row, index) => row.number === phones[index]?.number);
}

export function PhonesInput({ value, onChange, error, idPrefix = "phone" }: PhonesInputProps) {
  const [rows, setRows] = useState<PhoneRow[]>(() => toRows(value));

  // `value` может измениться извне — форма сбросилась или карточка получила
  // свежие данные с сервера. Пересборка только при фактическом расхождении
  // номеров: иначе она стирала бы недописанную строку на каждом рендере.
  const previous = useRef(value);
  useEffect(() => {
    if (previous.current === value) return;
    previous.current = value;

    setRows((current) => (sameNumbers(current, value) ? current : toRows(value)));
  }, [value]);

  const apply = (next: PhoneRow[]): void => {
    setRows(next);
    onChange(toValue(next));
  };

  const updateAt = (index: number, patch: Partial<PhoneRow>): void => {
    apply(rows.map((row, position) => (position === index ? { ...row, ...patch } : row)));
  };

  const handleNumberChange = (index: number, input: string): void => {
    const row = rows[index];
    if (row === undefined) return;

    const parsed = parsePhoneInput(input, row.countryCode);

    updateAt(index, {
      draft: formatAsYouType(input, row.countryCode),
      number: parsed.number,
      // Вставленный из буфера международный номер меняет страну: `+375…` при
      // выбранной России должен остаться белорусским.
      countryCode: (parsed.country_code ?? row.countryCode) as CountryCode,
      callingCode: parsed.calling_code ?? row.callingCode,
    });
  };

  const handleCountryChange = (index: number, country: CountryCode): void => {
    const row = rows[index];
    if (row === undefined) return;

    const digits = nationalPart(row.number, row.countryCode);
    const calling = callingCodeFor(country);

    updateAt(index, {
      countryCode: country,
      callingCode: calling,
      draft: formatAsYouType(digits, country),
      number: digits === "" ? "" : `${calling}${digits}`,
    });
  };

  const removeAt = (index: number): void => {
    const next = rows.filter((_, position) => position !== index);
    apply(next.length === 0 ? [emptyRow()] : next);
  };

  /** «Сделать основным» = переставить номер в начало: primary у Twenty — позиция 0. */
  const makePrimary = (index: number): void => {
    const target = rows[index];
    if (target === undefined) return;

    apply([target, ...rows.filter((_, position) => position !== index)]);
  };

  return (
    <div className="space-y-2">
      <span className="flex items-center gap-1.5 text-xs font-medium text-[#666666]">
        <Phone className="h-3 w-3" /> Телефоны
      </span>

      <div className="space-y-2">
        {rows.map((row, index) => {
          const invalid = row.number !== "" && !isValidPhone({
            number: row.number,
            country_code: row.countryCode,
          });
          const showRemove = rows.length > 1 || row.number !== "";

          return (
            <div key={row.id} className="flex items-start gap-2">
              <select
                aria-label="Код страны"
                value={row.countryCode}
                onChange={(event) => handleCountryChange(index, event.target.value as CountryCode)}
                className="w-[124px] shrink-0 rounded-[8px] border border-[#e5e5e5] bg-white px-2 py-2 text-[13px] text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
              >
                {COUNTRY_OPTIONS_SORTED.map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.callingCode} {option.label}
                  </option>
                ))}
              </select>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <input
                    id={`${idPrefix}-${row.id}`}
                    type="tel"
                    inputMode="tel"
                    value={row.draft}
                    onChange={(event) => handleNumberChange(index, event.target.value)}
                    placeholder="916 123 45 67"
                    aria-invalid={invalid}
                    className={cn(
                      "w-full min-w-0 rounded-[8px] border bg-white px-3 py-2 text-[13px] text-[#111111] placeholder:text-[#888888] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20",
                      invalid ? "border-rose-400" : "border-[#e5e5e5] focus:border-[#4a38f5]",
                    )}
                  />

                  {index === 0 ? (
                    <span
                      title="Основной номер"
                      className="flex h-8 w-8 shrink-0 items-center justify-center text-amber-500"
                    >
                      <Star className="h-3.5 w-3.5 fill-current" />
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => makePrimary(index)}
                      title="Сделать основным"
                      aria-label="Сделать основным"
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] text-[#888888] transition-colors hover:bg-[#f5f5f5] hover:text-[#4a38f5]"
                    >
                      <Star className="h-3.5 w-3.5" />
                    </button>
                  )}

                  {showRemove && (
                    <button
                      type="button"
                      onClick={() => removeAt(index)}
                      title="Удалить номер"
                      aria-label="Удалить номер"
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] text-[#888888] transition-colors hover:bg-rose-50 hover:text-rose-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                {invalid && <p className="mt-1 text-xs text-rose-500">Номер не подходит для выбранной страны</p>}
              </div>
            </div>
          );
        })}
      </div>

      {error !== undefined && <p className="text-xs text-rose-500">{error}</p>}

      <button
        type="button"
        onClick={() => apply([...rows, emptyRow()])}
        className="inline-flex items-center gap-1.5 rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 py-1.5 text-xs font-medium text-[#111111] transition-colors hover:bg-[#f5f5f5]"
      >
        <Plus className="h-3.5 w-3.5" /> Добавить номер
      </button>
    </div>
  );
}
