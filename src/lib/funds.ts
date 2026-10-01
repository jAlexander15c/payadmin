import { cents } from "./finance";
export const FUND_BUCKETS = ["NEEDS", "WANTS", "SAVINGS"] as const;
export type FundBucket = (typeof FUND_BUCKETS)[number];
type Row = Record<string, any>;
export type FundEffect = "ALLOCATION" | "INCOME" | "EXPENSE" | "ADJUSTMENT";
export function fundEffect(r: Row): FundEffect {
  return (
    r.effect ??
    (r.operation === "ADD"
      ? "ALLOCATION"
      : r.operation === "REMOVE"
        ? "EXPENSE"
        : "ADJUSTMENT")
  );
}
export const fundEffectNames: Record<FundEffect, string> = {
  ALLOCATION: "Dinero ya disponible",
  INCOME: "Ingreso extra",
  EXPENSE: "Gasto o salida nueva",
  ADJUSTMENT: "Ajuste de saldo",
};
export function fundBalances(
  d: { cash: Row[]; fundAdjustments?: Row[] },
  asOf: string,
) {
  const balances: Record<FundBucket, number> = {
    NEEDS: 0,
    WANTS: 0,
    SAVINGS: 0,
  };
  const configured: Record<FundBucket, boolean> = {
    NEEDS: false,
    WANTS: false,
    SAVINGS: false,
  };
  for (const r of d.cash) {
    if (r.status !== "active" || r.date > asOf) continue;
    if (r.kind === "INCOME" && FUND_BUCKETS.includes(r.category)) {
      balances[r.category as FundBucket] += cents(r.amount);
      configured[r.category as FundBucket] = true;
    } else if (r.kind === "SAVING" || r.kind === "SAVINGS_OPENING") {
      balances.SAVINGS += cents(r.amount);
      configured.SAVINGS = true;
    } else if (r.kind === "EXPENSE") {
      if (r.funding === "SAVINGS") balances.SAVINGS -= cents(r.amount);
      else if (FUND_BUCKETS.includes(r.category))
        balances[r.category as FundBucket] -= cents(r.amount);
    }
  }
  for (const r of d.fundAdjustments || []) {
    if (r.date > asOf) continue;
    balances[r.bucket as FundBucket] += cents(r.delta);
    configured[r.bucket as FundBucket] = true;
  }
  return FUND_BUCKETS.map((id) => ({
    id,
    name: { NEEDS: "Fijo", WANTS: "Personal", SAVINGS: "Ahorro" }[id],
    balance: balances[id],
    configured: configured[id],
  }));
}
