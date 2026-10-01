import { cents, paramsAt, split, sum, type Parameters } from "./finance";
import { fixedExpensesAt } from "./budget";
import { fundEffect, FUND_BUCKETS, type FundBucket } from "./funds";
type Row = Record<string, any>;
export const expenseBucketNames = {
  NEEDS: "Fijo",
  WANTS: "Personal",
  SAVINGS: "Ahorro",
};
export type ExpenseEntry = {
  id: string;
  date: string;
  period: string;
  concept: string;
  amount: number;
  direction: "IN" | "OUT" | "BALANCE";
  bucket: FundBucket;
  status: string;
  source: "entry" | "fund";
  fixedId: string | null;
  record: Row;
};
export function expensesFor(
  d: {
    expenseCash: Row[];
    fundAdjustments: Row[];
    fixedExpenses: Row[];
    versions: Parameters[];
  },
  period: string,
  half: "1" | "2" | "all",
) {
  const inPeriod = (date: string) =>
    date.slice(0, 7) === period &&
    (half === "all" || (Number(date.slice(8)) <= 15 ? "1" : "2") === half);
  const records: ExpenseEntry[] = [
    ...d.expenseCash
      .filter((r) => inPeriod(r.date))
      .map(
        (r): ExpenseEntry => ({
          id: r.id,
          date: r.date,
          period: r.period,
          concept: r.concept,
          amount: cents(r.amount),
          direction:
            r.kind === "INCOME"
              ? "IN"
              : r.kind === "EXPENSE"
                ? "OUT"
                : "BALANCE",
          bucket:
            r.funding === "SAVINGS" ||
            ["SAVING", "SAVINGS_OPENING"].includes(r.kind)
              ? "SAVINGS"
              : FUND_BUCKETS.includes(r.category)
                ? r.category
                : r.category === "DEBT"
                  ? "SAVINGS"
                  : "WANTS",
          status: r.status,
          source: "entry",
          fixedId: r.fixed_expense_id,
          record: r,
        }),
      ),
    ...d.fundAdjustments
      .filter(
        (r) =>
          inPeriod(r.date) && ["INCOME", "EXPENSE"].includes(fundEffect(r)),
      )
      .map(
        (r): ExpenseEntry => ({
          id: r.id,
          date: r.date,
          period: r.date.slice(0, 7),
          concept: r.reason,
          amount: cents(r.amount),
          direction: fundEffect(r) === "INCOME" ? "IN" : "OUT",
          bucket: r.bucket,
          status: "active",
          source: "fund",
          fixedId: null,
          record: r,
        }),
      ),
  ].sort(
    (a, b) =>
      b.date.localeCompare(a.date) ||
      String(b.record.created_at || "").localeCompare(
        String(a.record.created_at || ""),
      ) ||
      b.id.localeCompare(a.id),
  );
  const active = records.filter((r) => r.status === "active"),
    incoming = active.filter((r) => r.direction === "IN"),
    outgoing = active.filter((r) => r.direction === "OUT"),
    income = sum(incoming.map((r) => r.amount)),
    spent = sum(outgoing.map((r) => r.amount));
  const monthlySalary = paramsAt(d.versions, period).salary,
    salary =
      half === "all"
        ? monthlySalary
        : split(monthlySalary, [1, 1])[half === "1" ? 0 : 1],
    monthlyRefs = split(monthlySalary, [50, 30, 20]);
  const categories = FUND_BUCKETS.map((id, i) => {
    const used = sum(
        outgoing.filter((r) => r.bucket === id).map((r) => r.amount),
      ),
      income = sum(
        incoming.filter((r) => r.bucket === id).map((r) => r.amount),
      ),
      salaryReference =
        half === "all"
          ? monthlyRefs[i]
          : split(monthlyRefs[i], [1, 1])[half === "1" ? 0 : 1];
    return {
      id,
      name: expenseBucketNames[id],
      spent: used,
      income,
      salaryReference,
      share: spent > 0 ? (used / spent) * 100 : 0,
      salaryPercent:
        salaryReference > 0 ? (used / salaryReference) * 100 : null,
    };
  });
  const fixed = fixedExpensesAt(d.fixedExpenses, period)
    .map(
      (
        v,
      ): Row & {
        dueDate: string;
        planned: number;
        paid: number;
        pending: number;
      } => {
        const last = new Date(
            Number(period.slice(0, 4)),
            Number(period.slice(5, 7)),
            0,
          ).getDate(),
          dueDate = `${period}-${String(Math.min(v.due_day, last)).padStart(2, "0")}`,
          planned = cents(v.amount),
          paid = sum(
            d.expenseCash
              .filter(
                (r) =>
                  r.status === "active" &&
                  r.kind === "EXPENSE" &&
                  r.fixed_expense_id === v.fixed_id &&
                  r.period === period,
              )
              .map((r) => cents(r.amount)),
          );
        return {
          ...v,
          dueDate,
          planned,
          paid,
          pending: v.active ? Math.max(0, planned - paid) : 0,
        };
      },
    )
    .filter(
      (v) =>
        (v.active || v.paid > 0) &&
        (half === "all" ||
          (Number(v.dueDate.slice(8)) <= 15 ? "1" : "2") === half),
    );
  const days = new Map<
    string,
    { date: string; income: number; spent: number }
  >();
  for (const r of active) {
    if (r.direction === "BALANCE") continue;
    const day = days.get(r.date) || { date: r.date, income: 0, spent: 0 };
    if (r.direction === "IN") day.income += r.amount;
    else day.spent += r.amount;
    days.set(r.date, day);
  }
  return {
    period,
    half,
    records,
    income,
    spent,
    net: income - spent,
    salary,
    categories,
    fixed,
    fixedPending: sum(fixed.map((r) => r.pending)),
    daily: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
  };
}
