import {
  AsYouType,
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js";

// ---------------------------------------------------------------------------
// Телефоны контакта.
//
// Та же библиотека и та же роль, что у Twenty в `PhonesFieldInput`: ввод
// разбирается `libphonenumber-js`, из него берутся национальный номер, ISO-код
// страны и код звонка. Здесь эти операции собраны в одном месте, потому что их
// используют и форма создания, и inline-правка на карточке, и таблица.
//
// Хранится номер в E.164 (без разделителей), а показывается отформатированным:
// формат зависит от страны и меняется вместе с базой библиотеки, поэтому его
// нельзя записывать в БД — иначе поиск по номеру перестаёт находить записи.
// ---------------------------------------------------------------------------

export interface PhoneValue {
  number: string;
  country_code?: string;
  calling_code?: string;
}

/** Страна по умолчанию: основной рынок продукта. */
export const DEFAULT_COUNTRY: CountryCode = "RU";

export interface CountryOption {
  code: CountryCode;
  callingCode: string;
  label: string;
}

const RU_REGION_NAMES = new Intl.DisplayNames(["ru"], { type: "region" });

/**
 * Список стран для селектора кода.
 *
 * Строится из данных библиотеки, а не из своего списка: коды звонков меняются
 * (последний раз — при разделении номерных планов), и рукописный список
 * разошёлся бы с валидацией, которая берёт данные из библиотеки.
 */
export const COUNTRY_OPTIONS: readonly CountryOption[] = getCountries()
  .map((code) => ({
    code,
    callingCode: `+${getCountryCallingCode(code)}`,
    label: RU_REGION_NAMES.of(code) ?? code,
  }))
  .sort((left, right) => left.label.localeCompare(right.label, "ru"));

/** Приоритетные страны в начале списка: их выбирают чаще всего. */
const PRIORITY_COUNTRIES: readonly CountryCode[] = ["RU", "BY", "KZ", "UA", "UZ", "AM", "GE"];

export const COUNTRY_OPTIONS_SORTED: readonly CountryOption[] = [
  ...PRIORITY_COUNTRIES.map((code) => COUNTRY_OPTIONS.find((option) => option.code === code)).filter(
    (option): option is CountryOption => option !== undefined,
  ),
  ...COUNTRY_OPTIONS.filter((option) => !PRIORITY_COUNTRIES.includes(option.code)),
];

export function callingCodeFor(country: CountryCode): string {
  return `+${getCountryCallingCode(country)}`;
}

/**
 * Разбирает ввод в значение поля.
 *
 * Если пользователь ввёл номер с международным префиксом, страна берётся из
 * самого номера, а не из селектора: вставленный из буфера «+375…» при выбранной
 * России должен остаться белорусским, иначе валидация отклонит корректный номер.
 */
export function parsePhoneInput(input: string, fallbackCountry: CountryCode): PhoneValue {
  const trimmed = input.trim();
  if (trimmed === "") return { number: "", country_code: "", calling_code: "" };

  const parsed = parsePhoneNumberFromString(trimmed, fallbackCountry);

  if (parsed === undefined) {
    // Номер ещё не дописан: сохраняем цифры как есть, чтобы ввод не сбрасывался
    // на каждом символе, и оставляем страну из селектора.
    return {
      number: trimmed.replace(/[\s()\-.]/g, ""),
      country_code: fallbackCountry,
      calling_code: callingCodeFor(fallbackCountry),
    };
  }

  return {
    number: parsed.number,
    country_code: parsed.country ?? fallbackCountry,
    calling_code: `+${parsed.countryCallingCode}`,
  };
}

/**
 * Приводит хранимый код страны к типу библиотеки.
 *
 * В БД он лежит обычной строкой и может быть пустым (номер записан до появления
 * селектора), поэтому проверка нужна перед каждым разбором.
 */
function toCountryCode(value: string | undefined): CountryCode {
  return value !== undefined && value !== "" ? (value as CountryCode) : DEFAULT_COUNTRY;
}

/** Валиден ли номер для своей страны. Пустой номер валиден: поле необязательное. */
export function isValidPhone(value: PhoneValue): boolean {
  if (value.number === "") return true;

  const parsed = parsePhoneNumberFromString(value.number, toCountryCode(value.country_code));

  return parsed?.isValid() ?? false;
}

/** Международный формат для отображения: «+7 916 123-45-67». */
export function formatPhone(number: string, countryCode?: string): string {
  if (number === "") return "";

  const parsed = parsePhoneNumberFromString(number, toCountryCode(countryCode));

  return parsed?.formatInternational() ?? number;
}

/** Форматирование по ходу ввода — как `AsYouType` у Twenty в поле телефона. */
export function formatAsYouType(input: string, country: CountryCode): string {
  return new AsYouType(country).input(input);
}

/**
 * Национальная часть номера — то, что показывается в поле рядом с селектором
 * кода страны.
 *
 * Разбирается библиотекой, а не регуляркой. Вариант
 * `number.replace(/^\+\d+/, "")` выглядит рабочим, но `\d+` жадный и не
 * ограничен длиной кода: на `+79161234567` он снимает весь номер и возвращает
 * пустую строку. Из-за этого сохранённые номера показывались пустыми полями, а
 * смена страны обнуляла номер. Проверено в node.
 */
export function nationalPart(number: string, countryCode?: string): string {
  if (number === "") return "";

  const parsed = parsePhoneNumberFromString(number, toCountryCode(countryCode));
  if (parsed !== undefined) return parsed.nationalNumber;

  // Номер ещё не дописан и не разбирается: снимается только сам префикс страны,
  // если он известен, иначе остаётся как есть без ведущего плюса.
  const calling = countryCode !== undefined && countryCode !== ""
    ? callingCodeFor(countryCode as CountryCode)
    : "";

  if (calling !== "" && number.startsWith(calling)) return number.slice(calling.length);

  return number.replace(/^\+/, "");
}

/** Ссылка для набора: только цифры и плюс, без пробелов. */
export function telHref(number: string): string {
  return `tel:${number.replace(/[^\d+]/g, "")}`;
}
