import { ValidationError } from "../../plugins/errorHandler.js";

export type LandedCostAllocationMethod = "by_value" | "by_quantity" | "manual";

export interface LandedCostLineInput {
  id: string;
  quantity: number;
  baseUnitPrice: number;
  manualExtraCost?: number;
}

export interface LandedCostLineAllocation {
  id: string;
  quantity: number;
  baseUnitPrice: number;
  baseLineTotal: number;
  allocatedExtraCost: number;
  unitLandedCost: number;
  effectiveUnitPrice: number;
  effectiveLineTotal: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * Распределяет сумму доп. расходов (Landed Cost) по строкам приёмки с точностью до копейки.
 *
 * Методы:
 * - `by_value`: пропорционально сумме строки (`quantity * baseUnitPrice`). Если общая сумма строк 0 —
 *   безопасно переключается на `by_quantity`.
 * - `by_quantity`: пропорционально количеству (`quantity`).
 * - `manual`: использует `manualExtraCost` по строкам (при расхождении суммы до 0.01 ₽ корректирует последнюю строку).
 *
 * Компенсация округления: остаток копеек после округления всегда относится на последнюю принимаемую позицию,
 * чтобы `SUM(allocatedExtraCost) === totalExtraCost` ровно до копейки.
 */
export function allocateLandedCost(
  lines: LandedCostLineInput[],
  totalExtraCost: number,
  method: LandedCostAllocationMethod = "by_value",
): LandedCostLineAllocation[] {
  const activeLines = lines.filter((l) => l.quantity > 0);
  if (activeLines.length === 0) return [];

  const totalExtraCents = Math.max(0, Math.round(totalExtraCost * 100));

  if (totalExtraCents === 0) {
    return activeLines.map((l) => {
      const baseUnit = round2(l.baseUnitPrice);
      const baseTotal = round2(l.quantity * baseUnit);
      return {
        id: l.id,
        quantity: l.quantity,
        baseUnitPrice: baseUnit,
        baseLineTotal: baseTotal,
        allocatedExtraCost: 0,
        unitLandedCost: 0,
        effectiveUnitPrice: baseUnit,
        effectiveLineTotal: baseTotal,
      };
    });
  }

  const allocatedCents: number[] = new Array(activeLines.length).fill(0);

  if (method === "manual") {
    let assignedCents = 0;
    for (let i = 0; i < activeLines.length; i++) {
      const cents = Math.max(0, Math.round((activeLines[i]!.manualExtraCost ?? 0) * 100));
      allocatedCents[i] = cents;
      assignedCents += cents;
    }
    const diff = totalExtraCents - assignedCents;
    if (Math.abs(diff) > 1) {
      throw new ValidationError(
        `Сумма ручного распределения доп. расходов (${(assignedCents / 100).toFixed(2)} ₽) не совпадает с итогом доп. расходов (${(totalExtraCents / 100).toFixed(2)} ₽)`,
      );
    }
    if (diff !== 0) {
      const lastIdx = activeLines.length - 1;
      allocatedCents[lastIdx] = Math.max(0, (allocatedCents[lastIdx] ?? 0) + diff);
    }
  } else {
    const valueWeights = activeLines.map((l) => Math.max(0, l.quantity * l.baseUnitPrice));
    const totalValueWeight = valueWeights.reduce((acc, w) => acc + w, 0);

    const effectiveMethod: "by_value" | "by_quantity" =
      method === "by_value" && totalValueWeight > 0 ? "by_value" : "by_quantity";

    const weights =
      effectiveMethod === "by_value"
        ? valueWeights
        : activeLines.map((l) => Math.max(0, l.quantity));
    const totalWeight = weights.reduce((acc, w) => acc + w, 0);

    if (totalWeight > 0) {
      let runningCents = 0;
      for (let i = 0; i < activeLines.length; i++) {
        if (i === activeLines.length - 1) {
          // Компенсация копеек округления на последнюю позицию
          allocatedCents[i] = Math.max(0, totalExtraCents - runningCents);
        } else {
          const share = Math.floor((totalExtraCents * weights[i]!) / totalWeight);
          allocatedCents[i] = share;
          runningCents += share;
        }
      }
    }
  }

  return activeLines.map((l, idx) => {
    const baseUnit = round2(l.baseUnitPrice);
    const baseTotal = round2(l.quantity * baseUnit);
    const allocatedExtra = (allocatedCents[idx] ?? 0) / 100;
    const unitExtra = round4(allocatedExtra / l.quantity);
    const effectiveUnit = round2(baseUnit + unitExtra);
    const effectiveTotal = round2(baseTotal + allocatedExtra);

    return {
      id: l.id,
      quantity: l.quantity,
      baseUnitPrice: baseUnit,
      baseLineTotal: baseTotal,
      allocatedExtraCost: allocatedExtra,
      unitLandedCost: unitExtra,
      effectiveUnitPrice: effectiveUnit,
      effectiveLineTotal: effectiveTotal,
    };
  });
}
