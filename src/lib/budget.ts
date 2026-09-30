import Decimal from "decimal.js";
import {
  cents,
  paramsAt,
  monthIndex,
  INITIAL,
  sum,
  split,
  type Parameters,
  type Ledger,
  type Forecast,
} from "./finance";
type Row = Record<string, any>;
type BudgetData = {
  versions: Parameters[];
  real: Ledger;
  current: Forecast;
  contributions: Row[];
  cash: Row[];
  rawMovements: Row[];
  participants: Row[];
};
export function budgetFor(
  d: BudgetData,
  period: string,
  half: "1" | "2" | "all",
) {
  const p = paramsAt(d.versions, period),
    divisor = half === "all" ? 1 : 2,
    round = (n: number) =>
      half === "all" ? n : split(n, [1, 1])[half === "1" ? 0 : 1];
  const inHalf = (r: Row) =>
    r.date.slice(0, 7) === period &&
    (half === "all" || (Number(r.date.slice(8)) <= 15 ? "1" : "2") === half);
  const receipts = d.contributions.filter(
      (r) => r.status === "active" && inHalf(r),
    ),
    entries = d.cash.filter((r) => r.status === "active" && inHalf(r));
  const total = (rows: Row[]) => sum(rows.map((r) => cents(r.amount)));
  const income = total(
      entries.filter((r) => r.kind === "PAYROLL" || r.kind === "INCOME"),
    ),
    reimb = total(receipts),
    spent = total(entries.filter((r) => r.kind === "EXPENSE")),
    saving = total(entries.filter((r) => r.kind === "SAVING"));
  const extras = total(
    d.rawMovements.filter(
      (r) =>
        r.status === "active" &&
        r.type !== "REGULAR" &&
        r.type !== "NO_PAYMENT" &&
        inHalf(r),
    ),
  );
  const start = d.versions[0].firstDue.slice(0, 7),
    active =
      period >= start &&
      (!d.current.closeDate || period <= d.current.closeDate.slice(0, 7));
  const row =
    d.real.periods.find((x) => x.period === period) ||
    d.current.schedule.find((x) => x.period === period);
  const chunkyOpening =
    row?.sources?.chunky.opening ?? (period < start ? 0 : INITIAL.chunky);
  const crediOpening =
    row?.sources?.credi.opening ?? (period < start ? 0 : INITIAL.credi);
  const chunkyDue =
    chunkyOpening +
    (row?.sources?.chunky.interest || 0) +
    (row?.sources?.chunky.feci || 0) +
    (row?.sources?.chunky.other || 0);
  const gross = round(p.salary),
    regular = active ? round(p.regular) : 0,
    chunky = active ? round(Math.min(p.chunky, chunkyDue)) : 0,
    load = regular - chunky;
  const crediExpected =
    active && monthIndex(period) - monthIndex(start) < 24
      ? round(
          Math.min(
            p.credi,
            crediOpening +
              (row?.sources?.credi.interest || 0) +
              (row?.sources?.credi.feci || 0),
          ),
        )
      : 0;
  const net = p.salaryIncludesLoan ? gross : gross - regular,
    baselineSalary = p.salaryIncludesLoan
      ? p.salary + (active ? p.regular : 0)
      : p.salary;
  const refs = split(baselineSalary, [50, 30, 20]);
  const distribution = [
    {
      name: "Necesidades",
      percent: 50,
      color: "chunky",
      amount: round(refs[0]),
    },
    { name: "Gustos", percent: 30, color: "credi", amount: round(refs[1]) },
    {
      name: "Ahorro y deuda",
      percent: 20,
      color: "cards",
      amount: round(refs[2]),
    },
  ];
  const room = distribution[2].amount - load,
    resp = d.participants.filter((r) => r.effective_period <= period).at(-1),
    myPercent = resp?.participants.find(
      (r: Row) => r.name.trim().toLowerCase() === "javier",
    )?.percent;
  const myCredi =
    myPercent === undefined
      ? null
      : round(
          new Decimal(p.credi)
            .mul(myPercent)
            .div(100)
            .toDecimalPlaces(0)
            .toNumber(),
        );
  const assignedReceipts = d.contributions.filter(
    (r) =>
      r.status === "active" &&
      r.period === period &&
      (half === "all" || (Number(r.date.slice(8)) <= 15 ? "1" : "2") === half),
  );
  return {
    period,
    half,
    divisor,
    gross,
    regular,
    chunky,
    load,
    net,
    baselineSalary,
    distribution,
    room,
    income,
    reimb,
    spent,
    saving,
    extras,
    myPercent: myPercent ?? null,
    myCredi,
    scenarioCredi: round(p.credi),
    scenarioLiquid: room - round(p.credi),
    actualCash: income + reimb - spent - saving - extras,
    availableAfterExpected: net + chunky,
    salaryIncludesLoan: p.salaryIncludesLoan,
    contributions: (["chunky", "credi"] as const).map((source) => {
      const expected = source === "chunky" ? chunky : crediExpected,
        received = total(
          assignedReceipts.filter((r) => r.source_id === source),
        );
      return {
        source,
        expected,
        received,
        pending: Math.max(0, expected - received),
      };
    }),
  };
}
