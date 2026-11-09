// ---------------------------------------------------------------------------
// Identity Resolution & Name Enrichment for CRM Leads and Contacts.
//
// Извлекает реальные имена клиентов из:
// 1. Прямых сообщений переписки («Меня зовут Наталья», «Я Наталья» и т.п.)
// 2. Telegram username и профилей (@NataliaDiudiaeva -> Наталья Дюдяева)
// 3. Email адресов
// ---------------------------------------------------------------------------

const COMMON_NAMES_DICT: Record<string, string> = {
  natalia: "Наталья",
  natalya: "Наталья",
  nataliya: "Наталья",
  natali: "Наталья",
  natasha: "Наташа",
  elena: "Елена",
  alena: "Алёна",
  olga: "Ольга",
  anna: "Анна",
  tatiana: "Татьяна",
  tatyana: "Татьяна",
  ekaterina: "Екатерина",
  katerina: "Катерина",
  katya: "Катя",
  irina: "Ирина",
  marina: "Марина",
  svetlana: "Светлана",
  yulia: "Юлия",
  julia: "Юлия",
  oxana: "Оксана",
  oksana: "Оксана",
  ksenia: "Ксения",
  polina: "Полина",
  daria: "Дарья",
  darya: "Дарья",
  anastasia: "Анастасия",
  anastasiya: "Анастасия",
  mariya: "Мария",
  maria: "Мария",
  nadezhda: "Надежда",
  lyudmila: "Людмила",
  liudmila: "Людмила",
  vera: "Вера",
  victoria: "Виктория",
  viktoria: "Виктория",
  evgenia: "Евгения",
  alexander: "Александр",
  aleksandr: "Александр",
  alexey: "Алексей",
  aleksey: "Алексей",
  mikhail: "Михаил",
  dmitry: "Дмитрий",
  dmitriy: "Дмитрий",
  sergey: "Сергей",
  vladimir: "Владимир",
  andrey: "Андрей",
  ivan: "Иван",
  artem: "Артём",
  artyom: "Артём",
  denis: "Денис",
  pavel: "Павел",
  roman: "Роман",
  maksim: "Максим",
  maxim: "Максим",
  nikolay: "Николай",
  konstantin: "Константин",
  viktor: "Виктор",
  stanislav: "Станислав",
  anton: "Антон",
  ilya: "Илья",
  egor: "Егор",
  oleg: "Олег",
  timur: "Тимур",
  ruslan: "Руслан",
  vadim: "Вадим",
  gleb: "Глеб",
  yury: "Юрий",
  yuri: "Юрий",
  georgy: "Георгий",
  georgiy: "Георгий",
  boris: "Борис",
  valery: "Валерий",
  valeriy: "Валерий",
  alisa: "Алиса",
  dina: "Дина",
  inna: "Инна",
  kira: "Кира",
  lara: "Лара",
  larisa: "Лариса",
  maya: "Майя",
  mira: "Мира",
  nina: "Нина",
  rimma: "Римма",
  sofiya: "София",
  sofia: "София",
  tamara: "Тамара",
  alla: "Алла",
  zhanna: "Жанна",
  eliza: "Элиза",
  evgeniy: "Евгений",
  evgeny: "Евгений",
  daniil: "Даниил",
  danil: "Данил",
  lev: "Лев",
  fedor: "Фёдор",
  fyodor: "Фёдор",
  stepan: "Степан",
  semyon: "Семён",
  semen: "Семён",
  matvey: "Матвей",
  yaroslav: "Ярослав",
  kirill: "Кирилл",
};

/**
 * Транслитерация латиницы в кириллицу для русских имен и фамилий.
 */
export function transliterateLatinToCyrillic(latinStr: string): string {
  if (!latinStr) return "";
  const lower = latinStr.toLowerCase().trim();
  if (COMMON_NAMES_DICT[lower]) {
    return COMMON_NAMES_DICT[lower];
  }

  let s = lower;

  // Двух- и трёхбуквенные сочетания
  const multiRules: Array<[RegExp, string]> = [
    [/shch/g, "щ"],
    [/sch/g, "щ"],
    [/sh/g, "ш"],
    [/ch/g, "ч"],
    [/zh/g, "ж"],
    [/kh/g, "х"],
    [/ts/g, "ц"],
    [/diu/g, "дю"],
    [/tiu/g, "тю"],
    [/liu/g, "лю"],
    [/niu/g, "ню"],
    [/riu/g, "рю"],
    [/dia/g, "дя"],
    [/tia/g, "тя"],
    [/lia/g, "ля"],
    [/nia/g, "ня"],
    [/ria/g, "ря"],
    [/yu/g, "ю"],
    [/ya/g, "я"],
    [/yo/g, "ё"],
    [/ye/g, "е"],
    [/iu/g, "ю"],
    [/ia/g, "я"],
    [/je/g, "е"],
    [/ja/g, "я"],
    [/ju/g, "ю"],
  ];

  for (const [pattern, replacement] of multiRules) {
    s = s.replace(pattern, replacement);
  }

  const singleCharMap: Record<string, string> = {
    a: "а",
    b: "б",
    v: "в",
    w: "в",
    g: "г",
    d: "д",
    e: "е",
    z: "з",
    i: "и",
    j: "й",
    y: "й",
    k: "к",
    l: "л",
    m: "м",
    n: "н",
    o: "о",
    p: "п",
    r: "р",
    s: "с",
    t: "т",
    u: "у",
    f: "ф",
    h: "х",
    c: "к",
    q: "к",
    x: "кс",
  };

  s = s
    .split("")
    .map((char) => singleCharMap[char] || char)
    .join("");

  return s.charAt(0).toUpperCase() + s.slice(1);
}

const STOP_WORDS_SET = new Set([
  "здесь",
  "тут",
  "онлайн",
  "клиент",
  "посетитель",
  "пользователь",
  "заказчик",
  "покупатель",
  "мастер",
  "специалист",
  "директор",
  "менеджер",
  "врач",
  "косметолог",
  "отладчик",
  "тестер",
  "тестировщик",
  "программист",
  "разработчик",
  "админ",
  "администратор",
  "робот",
  "бот",
  "гость",
  "человек",
  "лид",
  "lead",
  "хочу",
  "могу",
  "буду",
  "ищу",
  "прошу",
  "думаю",
  "не",
  "уже",
  "тоже",
  "также",
  "очень",
  "просто",
  "только",
  "сейчас",
  "в",
  "на",
  "с",
  "по",
  "мой",
  "моя",
  "мое",
  "моё",
  "мои",
  "наш",
  "наша",
  "наше",
  "наши",
  "твой",
  "твоя",
  "твое",
  "твоё",
  "твои",
  "ваш",
  "ваша",
  "ваше",
  "ваши",
  "здравствуйте",
  "привет",
  "добрый",
  "номер",
  "телефон",
  "подскажите",
  "уточните",
  "скажите",
  "токсасагмск",
]);

/**
 * Проверяет, является ли имя контакта плейсхолдером/заглушкой:
 * «Клиент +79102470980», «Посетитель сайта (2671)», «Клиент», «noname» и т.п.
 */
export function isPlaceholderName(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
): boolean {
  const f = (firstName ?? "").trim().toLowerCase();
  const l = (lastName ?? "").trim().toLowerCase();
  const full = `${f} ${l}`.trim();

  if (full.length === 0) return true;
  if (STOP_WORDS_SET.has(f) || STOP_WORDS_SET.has(full)) return true;
  if (
    full === "клиент" ||
    full === "client" ||
    full === "не указано" ||
    full === "неизвестно" ||
    full === "лид" ||
    full === "lead" ||
    full === "отладчик" ||
    full === "debugger" ||
    full === "тестер" ||
    full === "tester" ||
    full === "тестировщик"
  ) {
    return true;
  }

  if (/^noname\d*$/i.test(full)) return true;
  if (/^(?:отладчик|тестер|тестировщик|debugger|tester)(?:\s*[\+\d\s\(\)\-_a-zа-яё]+)?$/i.test(full)) {
    return true;
  }
  // «Клиент +79102470980», «Клиент 79102470980», «Клиент (Онлайн-чат)»
  if (/^клиент(?:\s*[\+\d\s\(\)\-_a-zа-яё]+)?$/i.test(full) && !/^[А-ЯЁ][а-яё]+$/.test(f)) {
    return true;
  }
  // «Посетитель сайта (2671)», «Посетитель сайта», «Посетитель»
  if (/^посетитель(?:\s+сайта)?(?:\s*[\+\d\s\(\)\-_a-zа-яё]+)?$/i.test(full)) {
    return true;
  }
  // «Client +7910...»
  if (/^client(?:\s*[\+\d\s\(\)\-_a-zа-яё]+)?$/i.test(full)) {
    return true;
  }
  // Чистый номер телефона
  if (/^\+?\d[\d\s\(\)\-_]{6,}$/.test(full)) {
    return true;
  }

  return false;
}

/**
 * Извлекает имя и фамилию из текста сообщения клиента.
 * «Здравствуйте. Меня зовут Наталья. Номер +7...» -> { firstName: "Наталья" }
 * «Меня зовут Наталья Дюдяева» -> { firstName: "Наталья", lastName: "Дюдяева" }
 */
export function extractNameFromText(text: string | null | undefined): {
  firstName: string;
  lastName?: string;
} | null {
  if (!text || typeof text !== "string") return null;

  // Игнорируем стоп-слова, которые могут идти после "я", а также местоимения
  const stopWords = STOP_WORDS_SET;

  // 1. «меня зовут [Имя] [Фамилия]» или «мое имя [Имя]»
  const introMatch = text.match(
    /(?:меня\s+зовут|мое\s+имя|моё\s+имя|зовут\s+меня|зовут)\s+([А-ЯЁ][а-яё]+)(?:\s+([А-ЯЁ][а-яё]+))?/i,
  );
  if (introMatch && introMatch[1]) {
    const rawFirst = introMatch[1].trim();
    if (!stopWords.has(rawFirst.toLowerCase()) && rawFirst.length >= 2) {
      const firstName = rawFirst.charAt(0).toUpperCase() + rawFirst.slice(1).toLowerCase();
      let lastName: string | undefined;
      if (introMatch[2]) {
        const rawLast = introMatch[2].trim();
        if (!stopWords.has(rawLast.toLowerCase()) && rawLast.length >= 2) {
          lastName = rawLast.charAt(0).toUpperCase() + rawLast.slice(1).toLowerCase();
        }
      }
      return { firstName, lastName };
    }
  }

  // 2. «ФИО: [Имя] [Фамилия]» или «Имя: [Имя] [Фамилия]»
  const fieldMatch = text.match(
    /(?:фио|имя|контактное\s+лицо|клиент)\s*[:—\-]\s*([А-ЯЁ][а-яё]+)(?:\s+([А-ЯЁ][а-яё]+))?/i,
  );
  if (fieldMatch && fieldMatch[1]) {
    const rawFirst = fieldMatch[1].trim();
    if (!stopWords.has(rawFirst.toLowerCase()) && rawFirst.length >= 2) {
      const firstName = rawFirst.charAt(0).toUpperCase() + rawFirst.slice(1).toLowerCase();
      let lastName: string | undefined;
      if (fieldMatch[2]) {
        const rawLast = fieldMatch[2].trim();
        if (!stopWords.has(rawLast.toLowerCase()) && rawLast.length >= 2) {
          lastName = rawLast.charAt(0).toUpperCase() + rawLast.slice(1).toLowerCase();
        }
      }
      return { firstName, lastName };
    }
  }

  // 3. Email-подписи: «С уважением, [Имя] [Фамилия]», «С наилучшими пожеланиями, [Имя]»
  const signMatch = text.match(
    /(?:с\s+уважением|с\s+наилучшими\s+пожеланиями|искренне\s+ваш|best\s+regards|regards|thanks)[,\s\n]+([А-ЯЁ][а-яё]+)(?:\s+([А-ЯЁ][а-яё]+))?/i,
  );
  if (signMatch && signMatch[1]) {
    const rawFirst = signMatch[1].trim();
    if (!stopWords.has(rawFirst.toLowerCase()) && rawFirst.length >= 2) {
      const firstName = rawFirst.charAt(0).toUpperCase() + rawFirst.slice(1).toLowerCase();
      let lastName: string | undefined;
      if (signMatch[2]) {
        const rawLast = signMatch[2].trim();
        if (!stopWords.has(rawLast.toLowerCase()) && rawLast.length >= 2) {
          lastName = rawLast.charAt(0).toUpperCase() + rawLast.slice(1).toLowerCase();
        }
      }
      return { firstName, lastName };
    }
  }

  // 4. «Я [Имя] [Фамилия]» или «Это [Имя] [Фамилия]» в начале предложения
  const iAmMatch = text.match(
    /(?:^|[.!?\n]\s*)(?:я|это)\s+([А-ЯЁ][а-яё]+)(?:\s+([А-ЯЁ][а-яё]+))?(?:[,\.\s]|$)/i,
  );
  if (iAmMatch && iAmMatch[1]) {
    const rawFirst = iAmMatch[1].trim();
    if (!stopWords.has(rawFirst.toLowerCase()) && rawFirst.length >= 2) {
      const firstName = rawFirst.charAt(0).toUpperCase() + rawFirst.slice(1).toLowerCase();
      let lastName: string | undefined;
      if (iAmMatch[2]) {
        const rawLast = iAmMatch[2].trim();
        if (!stopWords.has(rawLast.toLowerCase()) && rawLast.length >= 2) {
          lastName = rawLast.charAt(0).toUpperCase() + rawLast.slice(1).toLowerCase();
        }
      }
      return { firstName, lastName };
    }
  }

  // 5. «[Имя] я» («антон я, мой номер...», «Иван я», «Наталья я»)
  const invertedIAmMatch = text.match(
    /(?:^|[.!?\n]\s*)([А-ЯЁ][а-яё]+)\s+я(?:[,\.\s]|$)/i,
  );
  if (invertedIAmMatch && invertedIAmMatch[1]) {
    const rawFirst = invertedIAmMatch[1].trim();
    if (!stopWords.has(rawFirst.toLowerCase()) && rawFirst.length >= 2) {
      const firstName = rawFirst.charAt(0).toUpperCase() + rawFirst.slice(1).toLowerCase();
      return { firstName };
    }
  }

  // 6. «[Имя], [мой номер / тел / контакты] ...» («Антон, 8915...», «Антон: мой номер +7915...»)
  const nameWithPhoneMatch = text.match(
    /(?:^|[.!?\n]\s*)([А-ЯЁ][а-яё]+)[,\s:]+(?:мой\s+номер|мой\s+телефон|мои\s+контакты|тел|телефон|номер|phone)?\s*[:—\-]?\s*(?:\+?7|8|\+?[1-9]\d{1,3})/i,
  );
  if (nameWithPhoneMatch && nameWithPhoneMatch[1]) {
    const rawFirst = nameWithPhoneMatch[1].trim();
    if (!stopWords.has(rawFirst.toLowerCase()) && rawFirst.length >= 2) {
      const firstName = rawFirst.charAt(0).toUpperCase() + rawFirst.slice(1).toLowerCase();
      return { firstName };
    }
  }

  return null;
}

/**
 * Очищает отображаемое имя контакта из профилей мессенджеров (Telegram, WhatsApp, MAX)
 * от суффиксов компаний, веб-доменов, должностей и технических пометок.
 *
 * Примеры:
 * «Антон team-big.ru» -> { firstName: "Антон" }
 * «Антон Сагайдак | team-big.ru» -> { firstName: "Антон", lastName: "Сагайдак" }
 * «Антон (ООО Вектор)» -> { firstName: "Антон" }
 * «Антон [HR]» -> { firstName: "Антон" }
 * «Алексей Смирнов / Руководитель» -> { firstName: "Алексей", lastName: "Смирнов" }
 * «team-big.ru» -> null (нет имени)
 */
export function cleanContactDisplayName(raw: string | null | undefined): {
  firstName: string;
  lastName?: string;
} | null {
  if (!raw || typeof raw !== "string") return null;

  let s = raw.trim();
  if (s.length === 0) return null;

  // 1. Удаляем явные URL и веб-домены (например, team-big.ru, www.site.com, site.io)
  s = s.replace(/https?:\/\/\S+/gi, " ");
  s = s.replace(/\b[a-zA-Z0-9-]+\.(?:ru|com|net|org|io|me|pro|ai|biz|info|site|online|app|xyz|tech|by|kz|ua)\b/gi, " ");

  // 2. Удаляем email и @handles
  s = s.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, " ");
  s = s.replace(/@[a-zA-Z0-9_]+/g, " ");

  // 3. Удаляем содержимое круглых и квадратных скобок (обычно названия компаний/роли)
  s = s.replace(/\([^)]*\)/g, " ");
  s = s.replace(/\[[^\]]*\]/g, " ");
  s = s.replace(/\{[^}]*\}/g, " ");

  // 4. Отрезаем суффиксы после разделителей ( |, -, /, \, —, –, : )
  const sepMatch = s.search(/\s+[|/\\—–-]\s+/);
  if (sepMatch !== -1) {
    s = s.slice(0, sepMatch);
  }

  // 5. Удаляем префиксы или суффиксы юрлиц (ИП, ООО, ЗАО, АО, LLC, Inc)
  s = s.replace(/\b(?:ИП|ООО|ЗАО|АО|ОАО|LLC|Inc|Corp|Ltd)\b.*$/gi, " ");

  // 6. Очищаем лишние спецсимволы и пробелы
  s = s.replace(/[^\p{L}\s-]/gu, " ").replace(/\s+/g, " ").trim();

  if (s.length < 2) return null;

  // Разделяем на слова
  const words = s
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2);

  if (words.length === 0) return null;

  const rawFirst = words[0];
  if (!rawFirst) return null;

  // Проверяем, не является ли первое слово заглушкой
  if (isPlaceholderName(rawFirst, "")) return null;

  // Нормализуем капитализацию
  const firstName = rawFirst.charAt(0).toUpperCase() + rawFirst.slice(1);
  let lastName: string | undefined;

  if (words.length >= 2 && words[1]) {
    const rawLast = words[1];
    if (!isPlaceholderName("", rawLast)) {
      lastName = rawLast.charAt(0).toUpperCase() + rawLast.slice(1);
    }
  }

  if (isPlaceholderName(firstName, lastName)) {
    return null;
  }

  return { firstName, lastName };
}

/**
 * Парсит имя и фамилию из Telegram username (CamelCase / snake_case).
 * СТРОГОЕ ПРАВИЛО: для предотвращения галлюцинаций и транслитерации ников (вроде toxasagmsk -> «Токсасагмск»)
 * имя признается валидным ТОЛЬКО если оно найдено в словаре русских имен или строго соответствует
 * структуре Имя_Фамилия с узнаваемым именем.
 *
 * «NataliaDiudiaeva» -> { firstName: "Наталья", lastName: "Дюдяева" }
 * «natalia_diudiaeva» -> { firstName: "Наталья", lastName: "Дюдяева" }
 * «alexey» -> { firstName: "Алексей" }
 * «toxasagmsk» -> null (произвольный никнейм не транслитерируется в имя человека)
 */
export function parseNameFromTelegramUsername(username: string | null | undefined): {
  firstName: string;
  lastName?: string;
} | null {
  if (!username || typeof username !== "string") return null;

  const clean = username.replace(/^@/, "").trim();
  if (clean.length < 3) return null;

  // Игнорируем чисто технические ники и системные аккаунты
  if (/^(?:bot|support|admin|info|sales|service|help|channel|group|chat|lead|manager)\b/i.test(clean)) {
    return null;
  }

  // Разделяем CamelCase, а также символы `_`, `.`, `-`
  const parts = clean
    .split(/(?=[A-Z])|[._\-]/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  if (parts.length >= 2) {
    const firstPart = parts[0]?.toLowerCase() ?? "";
    const secondPart = parts.slice(1).join("");

    // Случай 1: parts[0] - известное имя (natalia_diudiaeva, anton_sagaydak, NataliaDiudiaeva)
    if (COMMON_NAMES_DICT[firstPart] && secondPart.length >= 2) {
      const firstName = COMMON_NAMES_DICT[firstPart];
      const lastName = transliterateLatinToCyrillic(secondPart);
      if (firstName && lastName && !isPlaceholderName(firstName, lastName)) {
        return { firstName, lastName };
      }
    }

    // Случай 2: parts[parts.length - 1] - известное имя (diudiaeva_natalia, sagaydak_anton)
    const lastPart = parts[parts.length - 1]?.toLowerCase() ?? "";
    const leadingPart = parts.slice(0, parts.length - 1).join("");
    if (COMMON_NAMES_DICT[lastPart] && leadingPart.length >= 2) {
      const firstName = COMMON_NAMES_DICT[lastPart];
      const lastName = transliterateLatinToCyrillic(leadingPart);
      if (firstName && lastName && !isPlaceholderName(firstName, lastName)) {
        return { firstName, lastName };
      }
    }

    return null;
  } else if (parts.length === 1 && parts[0]) {
    // Для одиночного слова — ТОЛЬКО если оно есть в словаре реальных имен!
    // Категорически запрещено транслитерировать произвольные никнеймы (toxasagmsk, superman и т.п.)
    const lower = parts[0].toLowerCase();
    if (COMMON_NAMES_DICT[lower]) {
      return { firstName: COMMON_NAMES_DICT[lower] };
    }
    return null;
  }

  return null;
}

export interface ContactIdentityInput {
  messageText?: string | null;
  channelMetadata?: {
    senderName?: string | null;
    email?: string | null;
    telegramUsername?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    socials?: Array<{ kind: string; value: string }> | null;
  };
  currentContact?: {
    firstName?: string | null;
    lastName?: string | null;
  };
}

export interface ContactIdentityResult {
  firstName: string;
  lastName: string;
  source: "message_body" | "email_signature" | "sender_field" | "messenger_profile" | "telegram_username" | "existing";
  confidence: number;
}

/**
 * Многоуровневый экстрактор достоверного имени контакта (Contact Identity Resolver):
 * 1. Высший приоритет (Приоритет 1): Прямое представление или подпись в теле сообщения.
 * 2. Приоритет 2: Поле Sender / "От кого" / email-имя, если оно не является автогенерированной заглушкой.
 * 3. Приоритет 3: Метаданные мессенджера (firstName + lastName) или CamelCase-парсинг username.
 */
export function resolveContactIdentity(params: ContactIdentityInput): ContactIdentityResult | null {
  const currentF = params.currentContact?.firstName;
  const currentL = params.currentContact?.lastName;
  const isCurrentPlaceholder = isPlaceholderName(currentF, currentL);

  // 1. Приоритет 1: Тело сообщения или подпись письма
  const fromText = extractNameFromText(params.messageText);

  // 2. Приоритет 2: Поле От кого / Sender Name (если не заглушка)
  let fromSender: { firstName: string; lastName?: string } | null = null;
  const rawSender = (params.channelMetadata?.senderName ?? "").trim();
  if (rawSender && !isPlaceholderName(rawSender, "")) {
    const parts = rawSender.split(/\s+/).filter(Boolean);
    if (parts.length >= 2 && parts[0] && parts[1]) {
      fromSender = { firstName: parts[0], lastName: parts.slice(1).join(" ") };
    } else if (parts.length === 1 && parts[0] && parts[0].length >= 2) {
      fromSender = { firstName: parts[0] };
    }
  }

  // 3. Приоритет 3: Метаданные мессенджера (профиль / username)
  let fromProfile: { firstName: string; lastName?: string } | null = null;
  const pFirst = (params.channelMetadata?.firstName ?? "").trim();
  const pLast = (params.channelMetadata?.lastName ?? "").trim();
  if (pFirst && !isPlaceholderName(pFirst, pLast)) {
    fromProfile = { firstName: pFirst, lastName: pLast || undefined };
  } else {
    let tgUser = params.channelMetadata?.telegramUsername;
    if (!tgUser && Array.isArray(params.channelMetadata?.socials)) {
      const s = params.channelMetadata.socials.find((item) => item.kind === "telegram");
      if (s && s.value) tgUser = s.value;
    }
    const fromTg = parseNameFromTelegramUsername(tgUser);
    if (fromTg) {
      fromProfile = fromTg;
    }
  }

  // Выбор по матрице приоритетов и склейка Имени и Фамилии
  if (fromText) {
    const lastName = fromText.lastName || fromSender?.lastName || fromProfile?.lastName || "";
    return {
      firstName: fromText.firstName,
      lastName,
      source: "message_body",
      confidence: 1.0,
    };
  }

  if (fromSender) {
    const lastName = fromSender.lastName || fromProfile?.lastName || "";
    return {
      firstName: fromSender.firstName,
      lastName,
      source: "sender_field",
      confidence: 0.8,
    };
  }

  if (fromProfile) {
    return {
      firstName: fromProfile.firstName,
      lastName: fromProfile.lastName || "",
      source: "messenger_profile",
      confidence: 0.6,
    };
  }

  if (!isCurrentPlaceholder && currentF) {
    return {
      firstName: currentF,
      lastName: currentL || "",
      source: "existing",
      confidence: 0.5,
    };
  }

  return null;
}

/**
 * Комплексный резолвер реального имени клиента (обратная совместимость).
 */
export function resolveBestContactName(params: {
  currentFirstName?: string | null;
  currentLastName?: string | null;
  messageText?: string | null;
  telegramUsername?: string | null;
  senderName?: string | null;
  socials?: Array<{ kind: string; value: string }> | null;
}): { firstName: string; lastName: string } | null {
  const res = resolveContactIdentity({
    messageText: params.messageText,
    currentContact: {
      firstName: params.currentFirstName,
      lastName: params.currentLastName,
    },
    channelMetadata: {
      senderName: params.senderName,
      telegramUsername: params.telegramUsername,
      socials: params.socials,
    },
  });

  if (!res) return null;
  return { firstName: res.firstName, lastName: res.lastName };
}
