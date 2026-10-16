// Russian amount-to-words converter (for invoice "total in words" field)
const HUNDREDS = ["", "сто ", "двести ", "триста ", "четыреста ", "пятьсот ", "шестьсот ", "семьсот ", "восемьсот ", "девятьсот "];
const TENS = ["", "", "двадцать ", "тридцать ", "сорок ", "пятьдесят ", "шестьдесят ", "семьдесят ", "восемьдесят ", "девяносто "];
const UNDER_20 = ["", "один", "два", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять", "десять", "одиннадцать", "двенадцать", "тринадцать", "четырнадцать", "пятнадцать", "шестнадцать", "семнадцать", "восемнадцать", "девятнадцать"];
const UNDER_20_FEM = ["", "одна", "две", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять", "десять", "одиннадцать", "двенадцать", "тринадцать", "четырнадцать", "пятнадцать", "шестнадцать", "семнадцать", "восемнадцать", "девятнадцать"];

const THOUSANDS = ["", "тысяча ", "тысячи ", "тысяч "];
const MILLIONS = ["", "миллион ", "миллиона ", "миллионов "];
const RUBLES = ["рубль", "рубля", "рублей"];
const KOPECKS = ["копейка", "копейки", "копеек"];

function pluralForm(n: number, forms: string[]): string {
  const m = Math.abs(n) % 100;
  if (m > 10 && m < 20) return forms[2];
  const d = m % 10;
  if (d === 1) return forms[0];
  if (d >= 2 && d <= 4) return forms[1];
  return forms[2];
}

function numberToWords(n: number, feminine: boolean): string {
  if (n === 0) return "";
  let result = "";
  if (n >= 100) { result += HUNDREDS[Math.floor(n / 100)]; n %= 100; }
  if (n >= 20) { result += TENS[Math.floor(n / 10)]; n %= 10; }
  if (n > 0) { result += (feminine ? UNDER_20_FEM : UNDER_20)[n] + " "; }
  return result;
}

export function amountToWords(rubles: number, kopecks: number): string {
  const rub = Math.floor(rubles);
  const kop = Math.round(kopecks);

  const rubStr =
    (rub >= 1_000_000 ? numberToWords(Math.floor(rub / 1_000_000), false) + pluralForm(Math.floor(rub / 1_000_000), MILLIONS) : "") +
    (rub % 1_000_000 >= 1_000 ? numberToWords(Math.floor((rub % 1_000_000) / 1_000), true) + pluralForm(Math.floor((rub % 1_000_000) / 1_000), THOUSANDS) : "") +
    (rub % 1_000 > 0 ? numberToWords(rub % 1_000, false) : "");

  const rubWord = pluralForm(rub, RUBLES);
  const kopDigit = kop.toString().padStart(2, "0");
  const kopWord = pluralForm(kop, KOPECKS);

  const rubCapitalized = rubStr.charAt(0).toUpperCase() + rubStr.slice(1);
  return `${rubCapitalized}${rubWord} ${kopDigit} ${kopWord}`;
}