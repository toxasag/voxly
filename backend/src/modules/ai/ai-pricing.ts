// ---------------------------------------------------------------------------
// Тарификация вызовов ИИ.
//
// Единственное место, где токены превращаются в деньги. Каталог живёт на сервере,
// а не на фронтенде: цена — основание для списания с баланса, и клиент не должен
// иметь возможности её задать. Фронтенд получает готовые суммы.
//
// Все денежные величины — целые копейки. NUMERIC с плавающей точкой здесь
// недопустим: 0.1 + 0.2 ≠ 0.3, и остаток баланса со временем расходился бы с
// суммой операций.
// ---------------------------------------------------------------------------

export type AiModelId =
  | "gpt-4o"
  | "gpt-4o-mini"
  | "claude-sonnet-4"
  | "claude-opus-4"
  | "deepseek-v3"
  | "gemini-1.5-pro";

export const AI_MODEL_IDS: readonly AiModelId[] = [
  "gpt-4o",
  "gpt-4o-mini",
  "claude-sonnet-4",
  "claude-opus-4",
  "deepseek-v3",
  "gemini-1.5-pro",
];

export interface AiModelPricing {
  id: AiModelId;
  label: string;
  provider: "openai" | "anthropic" | "deepseek" | "google";
  contextWindow: number;
  /** Себестоимость входных токенов у провайдера, копеек за 1000 токенов. */
  costInPer1k: number;
  /** Себестоимость выходных токенов у провайдера, копеек за 1000 токенов. */
  costOutPer1k: number;
}

/**
 * Себестоимость в копейках за 1000 токенов.
 *
 * Значения соответствуют каталогу фронтенда (`lib/ai-bots/ai-bots.types.ts`),
 * переведённому из рублей в копейки: там 0.45 ₽ — это 45 копеек.
 */
export const AI_MODEL_CATALOG: Record<AiModelId, AiModelPricing> = {
  "gpt-4o": {
    id: "gpt-4o",
    label: "GPT-4o",
    provider: "openai",
    contextWindow: 128_000,
    costInPer1k: 45,
    costOutPer1k: 135,
  },
  "gpt-4o-mini": {
    id: "gpt-4o-mini",
    label: "GPT-4o mini",
    provider: "openai",
    contextWindow: 128_000,
    costInPer1k: 3,
    costOutPer1k: 11,
  },
  "claude-sonnet-4": {
    id: "claude-sonnet-4",
    label: "Claude Sonnet 4",
    provider: "anthropic",
    contextWindow: 200_000,
    costInPer1k: 27,
    costOutPer1k: 135,
  },
  "claude-opus-4": {
    id: "claude-opus-4",
    label: "Claude Opus 4",
    provider: "anthropic",
    contextWindow: 200_000,
    costInPer1k: 135,
    costOutPer1k: 675,
  },
  "deepseek-v3": {
    id: "deepseek-v3",
    label: "DeepSeek V3",
    provider: "deepseek",
    contextWindow: 64_000,
    costInPer1k: 2,
    costOutPer1k: 9,
  },
  "gemini-1.5-pro": {
    id: "gemini-1.5-pro",
    label: "Gemini 1.5 Pro",
    provider: "google",
    contextWindow: 1_000_000,
    costInPer1k: 11,
    costOutPer1k: 45,
  },
};

export function isAiModelId(value: string): value is AiModelId {
  return Object.prototype.hasOwnProperty.call(AI_MODEL_CATALOG, value);
}

export interface AiChargeBreakdown {
  /** Себестоимость у провайдера, копейки. */
  providerCostKopecks: number;
  /** Сумма к списанию с арендатора с учётом наценки, копейки. */
  chargedKopecks: number;
}

/**
 * Считает себестоимость и сумму списания.
 *
 * Округление вверх (`ceil`) на итоговой сумме, а не на промежуточных: иначе
 * тысячи мелких вызовов по 0.4 копейки списывались бы как ноль, и расход ИИ был
 * бы бесплатным для арендатора при реальных затратах платформы.
 */
export function calculateAiCharge(input: {
  model: AiModelId;
  tokensIn: number;
  tokensOut: number;
  markupPercent: number;
}): AiChargeBreakdown {
  const pricing = AI_MODEL_CATALOG[input.model];

  const providerCost =
    (input.tokensIn / 1000) * pricing.costInPer1k +
    (input.tokensOut / 1000) * pricing.costOutPer1k;

  const charged = providerCost * (1 + input.markupPercent / 100);

  return {
    providerCostKopecks: Math.ceil(providerCost),
    // max(0): наценка ниже -100% запрещена на уровне БД, но отрицательная сумма
    // списания превратила бы расход в пополнение — страхуемся и здесь.
    chargedKopecks: Math.max(0, Math.ceil(charged)),
  };
}

/**
 * Сколько токенов остаётся при текущем балансе для заданной модели.
 *
 * Нужно интерфейсу: «12 400 ₽» само по себе не отвечает на вопрос, надолго ли
 * этого хватит. Оценка по соотношению 1:1 между входом и выходом — усреднение,
 * а не гарантия.
 */
export function estimateRemainingTokens(input: {
  balanceKopecks: number;
  model: AiModelId;
  markupPercent: number;
}): number {
  const pricing = AI_MODEL_CATALOG[input.model];
  const per1k = (pricing.costInPer1k + pricing.costOutPer1k) * (1 + input.markupPercent / 100);

  if (per1k <= 0) return 0;

  return Math.max(0, Math.floor((input.balanceKopecks / per1k) * 1000));
}

/** Копейки в рубли для отображения. Деление только на выходе из домена. */
export function kopecksToRubles(kopecks: number): number {
  return Math.round(kopecks) / 100;
}

export function rublesToKopecks(rubles: number): number {
  return Math.round(rubles * 100);
}
