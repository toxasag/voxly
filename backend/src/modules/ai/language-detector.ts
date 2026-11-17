// ---------------------------------------------------------------------------
// Language Detection & Mirroring Directives for GETVOXLY AI Agents.
//
// Гарантирует абсолютное соблюдение Language Mirroring:
// Если пользователь пишет по-английски — бот отвечает строго на английском;
// если по-русски — на русском; если на испанском, немецком, французском,
// тайском, китайском, турецком, казахском — на языке пользователя.
//
// Никакой языковой инерции от русскоязычного системного промпта, базы знаний
// или предыдущих реплик в истории диалога.
// ---------------------------------------------------------------------------

export type SupportedLang =
  | "en"
  | "ru"
  | "es"
  | "de"
  | "fr"
  | "th"
  | "zh"
  | "tr"
  | "kk"
  | "other";

export interface LanguageDetectionResult {
  lang: SupportedLang;
  label: string;
  isCyrillic: boolean;
  isLatin: boolean;
  directive: string;
}

const EN_WORDS = /\b(hello|hi|hey|greetings|good\s+(?:morning|afternoon|evening|day)|how\s+are\s+you|what|where|how|when|why|who|which|whose|can|could|would|will|do|does|did|is|are|am|was|were|have|has|had|we|you|they|it|this|that|please|thanks?|thank\s+you|yes|no|ok|okay|sure|repair|fix|service|maintenance|pool|pools?|swimming|clean|cleaning|house|condo|apartment|renovation|price|cost|quote|how\s+much|contact|phone|number|call|available|book|booking|work|engineer|specialist|help|need|want|information|details)\b/i;

const ES_WORDS = /\b(hola|buenos?\s+(?:dias?|tardes?|noches?)|gracias|por\s+favor|precio|costo|cuanto|como|donde|cuando|piscina|alberca|reparar|reparacion|mantenimiento|casa|limpieza|ayuda|necesito|quiero|buenas)\b/i;

const DE_WORDS = /\b(hallo|guten?\s+(?:tag|morgen|abend)|danke|bitte|preis|kosten|wie\s+viel|wie|wo|was|wann|warum|wer|schwimmbad|reparieren|reparatur|wartung|haus|reinigung|hilfe|brauche|moechte)\b/i;

const FR_WORDS = /\b(bonjour|bonsoir|salut|merci|s'il\s+vous\s+plait|combien|prix|cout|comment|ou|pourquoi|qui|quand|piscine|reparer|reparation|entretien|maison|nettoyage|aide|besoin)\b/i;

const TR_WORDS = /\b(merhaba|selam|gunaydin|iyi\s+(?:gunler|aksamlar)|tesekkurler|lutfen|fiyat|ucret|kac|nasil|nerede|ne\s+zaman|havuz|tamir|bakim|temizlik)\b/i;

const TR_SPECIFIC = /[ğĞıİşŞ]/;

const KK_SPECIFIC = /[әіңғүұқөһӘІҢҒҮҰҚӨҺ]/;

/**
 * Определяет язык сообщения пользователя по скрипту (Unicode) и словарям,
 * с учетом контекста страницы (URL, title).
 */
export function detectMessageLanguage(
  text: string,
  context?: { pageUrl?: string; pageTitle?: string },
): LanguageDetectionResult {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return makeNeutralResult(context);
  }

  // Считаем символы различных систем письменности
  const cyrillicMatches = trimmed.match(/[\u0400-\u04FF]/g) || [];
  const latinMatches = trimmed.match(/[a-zA-Z]/g) || [];
  const thaiMatches = trimmed.match(/[\u0E00-\u0E7F]/g) || [];
  const cjkMatches = trimmed.match(/[\u4E00-\u9FFF]/g) || [];

  const cyrillicCount = cyrillicMatches.length;
  const latinCount = latinMatches.length;
  const thaiCount = thaiMatches.length;
  const cjkCount = cjkMatches.length;

  // 1. Тайский язык
  if (thaiCount >= 2 && thaiCount > latinCount && thaiCount > cyrillicCount) {
    return {
      lang: "th",
      label: "Thai",
      isCyrillic: false,
      isLatin: false,
      directive:
        "MANDATORY LANGUAGE DIRECTIVE: The user's message is in THAI (ภาษาไทย). You MUST formulate your entire response ('message1', 'message2') strictly in natural THAI. Do NOT reply in Russian or English.",
    };
  }

  // 2. Китайский язык
  if (cjkCount >= 2 && cjkCount > latinCount && cjkCount > cyrillicCount) {
    return {
      lang: "zh",
      label: "Chinese",
      isCyrillic: false,
      isLatin: false,
      directive:
        "MANDATORY LANGUAGE DIRECTIVE: The user's message is in CHINESE (中文). You MUST formulate your entire response ('message1', 'message2') strictly in CHINESE. Do NOT reply in Russian or English.",
    };
  }

  // 3. Кириллица (русский / казахский)
  if (cyrillicCount > 0 && cyrillicCount >= latinCount) {
    if (KK_SPECIFIC.test(trimmed)) {
      return {
        lang: "kk",
        label: "Kazakh",
        isCyrillic: true,
        isLatin: false,
        directive:
          "МІНДЕТТІ ТІЛДІК НҰСҚАУЛЫҚ: Пайдаланушының хабарламасы ҚАЗАҚ ТІЛІНДЕ. Сіздің барлық жауабыңыз ('message1', 'message2') қатаң түрде ҚАЗАҚ ТІЛІНДЕ жазылуы тиіс.",
      };
    }
    return {
      lang: "ru",
      label: "Russian",
      isCyrillic: true,
      isLatin: false,
      directive:
        "ДИРЕКТИВА ЯЗЫКА: Сообщение пользователя на РУССКОМ языке. Твой ответ ('message1', 'message2') должен быть строго на РУССКОМ языке.",
    };
  }

  // 4. Латиница (английский, испанский, немецкий, французский, турецкий)
  if (latinCount > 0) {
    // Проверяем турецкие специфические буквы и слова
    if (TR_SPECIFIC.test(trimmed) || TR_WORDS.test(trimmed)) {
      return {
        lang: "tr",
        label: "Turkish",
        isCyrillic: false,
        isLatin: true,
        directive:
          "ZORUNLU DİL TALİMATI: Kullanıcının mesajı TÜRKÇE. Yanıtınızın tamamı ('message1', 'message2') kesinlikle TÜRKÇE yazılmalıdır. Rusça veya İngilizce cevap vermeyin.",
      };
    }

    if (ES_WORDS.test(trimmed)) {
      return {
        lang: "es",
        label: "Spanish",
        isCyrillic: false,
        isLatin: true,
        directive:
          "DIRECTIVA DE IDIOMA OBLIGATORIA: El mensaje del usuario está en ESPAÑOL. Tu respuesta completa ('message1', 'message2') DEBE estar escrita estrictamente en ESPAÑOL. No respondas en ruso ni en inglés.",
      };
    }

    if (DE_WORDS.test(trimmed)) {
      return {
        lang: "de",
        label: "German",
        isCyrillic: false,
        isLatin: true,
        directive:
          "VERBINDLICHE SPRACHRICHTLINIE: Die Nachricht des Benutzers ist auf DEUTSCH. Ihre gesamte Antwort ('message1', 'message2') MUSS strikt auf DEUTSCH verfasst sein. Antworten Sie nicht auf Russisch.",
      };
    }

    if (FR_WORDS.test(trimmed)) {
      return {
        lang: "fr",
        label: "French",
        isCyrillic: false,
        isLatin: true,
        directive:
          "DIRECTIVE LINGUISTIQUE OBLIGATOIRE: Le message de l'utilisateur est en FRANÇAIS. Votre réponse complète ('message1', 'message2') DOIT être rédigée strictement en FRANÇAIS. Ne répondez pas en russe.",
      };
    }

    // Проверяем английские слова или любую латиницу по умолчанию
    if (EN_WORDS.test(trimmed) || latinCount > 0) {
      return {
        lang: "en",
        label: "English",
        isCyrillic: false,
        isLatin: true,
        directive:
          "CRITICAL LANGUAGE DIRECTIVE: The user's incoming message is in ENGLISH. Your entire response ('message1', 'message2') MUST BE WRITTEN STRICTLY IN ENGLISH. You are strictly forbidden from answering in Russian, even if the system prompt or knowledge base is in Russian. Translate all necessary facts into natural English.",
      };
    }
  }

  // 5. Нейтральный ввод (только цифры, знаки препинания, emoji)
  return makeNeutralResult(context);
}

function makeNeutralResult(context?: { pageUrl?: string; pageTitle?: string }): LanguageDetectionResult {
  const url = context?.pageUrl?.toLowerCase() || "";
  const title = context?.pageTitle?.toLowerCase() || "";

  // Если открыта английская версия страницы сайта (/en, /en/, /en?...)
  if (url.includes("/en") || /\b(en|english)\b/.test(title)) {
    return {
      lang: "en",
      label: "English (Page Context)",
      isCyrillic: false,
      isLatin: true,
      directive:
        "CRITICAL LANGUAGE DIRECTIVE: The user is browsing the ENGLISH version of the website. Your entire response ('message1', 'message2') MUST BE IN ENGLISH.",
    };
  }

  // Если открыта русская версия страницы (/ru)
  if (url.includes("/ru") || /[\u0400-\u04FF]/.test(title)) {
    return {
      lang: "ru",
      label: "Russian (Page Context)",
      isCyrillic: true,
      isLatin: false,
      directive:
        "ДИРЕКТИВА ЯЗЫКА: Посетитель находится на русскоязычной странице сайта. Отвечай на русском языке.",
    };
  }

  return {
    lang: "other",
    label: "Auto-detect",
    isCyrillic: false,
    isLatin: false,
    directive:
      "LANGUAGE MIRRORING DIRECTIVE: Detect the exact language used by the user and respond strictly in that same language. Never force Russian on non-Russian speakers.",
  };
}
