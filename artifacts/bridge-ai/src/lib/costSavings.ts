export interface CostSavingsResult {
  vibaActual: number;
  premiumEstimate: number;
  savedAmount: number;
  savedPct: number;
}

export function computeSavings(
  vibaActual: number,
  premiumEstimate: number,
): CostSavingsResult {
  const savedAmount = Math.max(0, premiumEstimate - vibaActual);
  const savedPct = premiumEstimate > 0 ? (savedAmount / premiumEstimate) * 100 : 0;
  return { vibaActual, premiumEstimate, savedAmount, savedPct };
}

export function fmtUSD(n: number): string {
  if (n < 0.01) return "<$0.01";
  return "$" + n.toFixed(2);
}

export function fmtPct(n: number): string {
  return Math.round(n) + "%";
}
