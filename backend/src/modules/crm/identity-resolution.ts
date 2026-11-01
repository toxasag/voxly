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
  if (
    full === "клиент" ||
    full === "client" ||
    full === "не указано" ||
    full === "неизвестно" ||
    full === "лид" ||
    full === "lead"
  ) {
    return true;
  }

  if (/^noname\d*$/i.test(full)) return true;
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

  // Игнорируем стоп-слова, которые могут идти после "я"
  const stopWords = new Set([
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
  ]);

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

  // 2. «Я [Имя] [Фамилия]» в начале предложения
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

  return null;
}

/**
 * Парсит имя и фамилию из Telegram username (CamelCase / snake_case).
 * «NataliaDiudiaeva» -> { firstName: "Наталья", lastName: "Дюдяева" }
 * «natalia_diudiaeva» -> { firstName: "Наталья", lastName: "Дюдяева" }
 */
export function parseNameFromTelegramUsername(username: string | null | undefined): {
  firstName: string;
  lastName?: string;
} | null {
  if (!username || typeof username !== "string") return null;

  const clean = username.replace(/^@/, "").trim();
  if (clean.length < 3) return null;

  // Разделяем CamelCase, а также символы `_`, `.`, `-`
  const parts = clean
    .split(/(?=[A-Z])|[._\-]/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  if (parts.length >= 2) {
    const firstPart = parts[0];
    const secondPart = parts.slice(1).join("");
    if (firstPart && secondPart) {
      const firstName = transliterateLatinToCyrillic(firstPart);
      const lastName = transliterateLatinToCyrillic(secondPart);
      return { firstName, lastName };
    }
  } else if (parts.length === 1 && parts[0]) {
    const firstName = transliterateLatinToCyrillic(parts[0]);
    return { firstName };
  }

  return null;
}

/**
 * Комплексный резолвер реального имени клиента.
 * Проверяет сообщение, Telegram, socials и возвращает наиболее достоверное имя.
 */
export function resolveBestContactName(params: {
  currentFirstName?: string | null;
  currentLastName?: string | null;
  messageText?: string | null;
  telegramUsername?: string | null;
  socials?: Array<{ kind: string; value: string }> | null;
}): { firstName: string; lastName: string } | null {
  const isCurrentPlaceholder = isPlaceholderName(params.currentFirstName, params.currentLastName);

  // 1. Попытка извлечь имя из текста сообщения
  const fromText = extractNameFromText(params.messageText);

  // 2. Попытка извлечь имя из Telegram username
  let tgUsername = params.telegramUsername;
  if (!tgUsername && Array.isArray(params.socials)) {
    const tgSocial = params.socials.find((s) => s.kind === "telegram");
    if (tgSocial && tgSocial.value) {
      tgUsername = tgSocial.value;
    }
  }

  const fromTg = parseNameFromTelegramUsername(tgUsername);

  // Если оба источника дали данные, объединяем:
  // Имя из текста (например «Наталья») + фамилия из Telegram (например «Дюдяева»)
  if (fromText && fromTg) {
    return {
      firstName: fromText.firstName || fromTg.firstName,
      lastName: fromText.lastName || fromTg.lastName || "",
    };
  }

  if (fromText) {
    return {
      firstName: fromText.firstName,
      lastName: fromText.lastName || "",
    };
  }

  if (fromTg) {
    return {
      firstName: fromTg.firstName,
      lastName: fromTg.lastName || "",
    };
  }

  // Если текущее имя не плейсхолдер — оставляем его
  if (!isCurrentPlaceholder && params.currentFirstName) {
    return {
      firstName: params.currentFirstName,
      lastName: params.currentLastName || "",
    };
  }

  return null;
}
