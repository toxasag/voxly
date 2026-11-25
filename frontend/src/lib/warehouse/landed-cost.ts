import type { LandedCostAllocationMethod } from "@/lib/api/use-warehouse";

export interface PreviewLandedCostLine {
  id: string;
  quantity: number;
  baseUnitPrice: number;
  manualExtraCost?: number;
}

export interface PreviewLandedCostResult {
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
 * Клиентский предпросмотр распределения доп. расходов (идентичен backend `allocateLandedCost`).
 * Остаток копеек от округления относится на последнюю активную позицию.
 */
export function previewLandedCostAllocation(
  lines: PreviewLandedCostLine[],
  totalExtraCost: number,
  method: LandedCostAllocationMethod,
): {
  allocations: Map<string, PreviewLandedCostResult>;
  manualUnallocated: number;
} {
  const activeLines = lines.filter((l) => l.quantity > 0);
  const allocations = new Map<string, PreviewLandedCostResult>();
  const totalExtraCents = Math.max(0, Math.round(totalExtraCost * 100));

  if (activeLines.length === 0) {
    return { allocations, manualUnallocated: totalExtraCents / 100 };
  }

  if (totalExtraCents === 0) {
    for (const l of activeLines) {
      const baseUnit = round2(l.baseUnitPrice);
      const baseTotal = round2(l.quantity * baseUnit);
      allocations.set(l.id, {
        id: l.id,
        quantity: l.quantity,
        baseUnitPrice: baseUnit,
        baseLineTotal: baseTotal,
        allocatedExtraCost: 0,
        unitLandedCost: 0,
        effectiveUnitPrice: baseUnit,
        effectiveLineTotal: baseTotal,
      });
    }
    return { allocations, manualUnallocated: 0 };
  }

  const allocatedCents: number[] = new Array(activeLines.length).fill(0);
  let manualUnallocated = 0;

  if (method === "manual") {
    let assignedCents = 0;
    for (let i = 0; i < activeLines.length; i++) {
      const cents = Math.max(0, Math.round((activeLines[i]!.manualExtraCost ?? 0) * 100));
      allocatedCents[i] = cents;
      assignedCents += cents;
    }
    manualUnallocated = (totalExtraCents - assignedCents) / 100;
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
          allocatedCents[i] = Math.max(0, totalExtraCents - runningCents);
        } else {
          const share = Math.floor((totalExtraCents * weights[i]!) / totalWeight);
          allocatedCents[i] = share;
          runningCents += share;
        }
      }
    }
  }

  for (let i = 0; i < activeLines.length; i++) {
    const l = activeLines[i]!;
    const baseUnit = round2(l.baseUnitPrice);
    const baseTotal = round2(l.quantity * baseUnit);
    const allocatedExtra = (allocatedCents[i] ?? 0) / 100;
    const unitExtra = round4(allocatedExtra / l.quantity);
    const effectiveUnit = round2(baseUnit + unitExtra);
    const effectiveTotal = round2(baseTotal + allocatedExtra);

    allocations.set(l.id, {
      id: l.id,
      quantity: l.quantity,
      baseUnitPrice: baseUnit,
      baseLineTotal: baseTotal,
      allocatedExtraCost: allocatedExtra,
      unitLandedCost: unitExtra,
      effectiveUnitPrice: effectiveUnit,
      effectiveLineTotal: effectiveTotal,
    });
  }

  return { allocations, manualUnallocated };
}
