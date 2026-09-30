import Decimal from "decimal.js";
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export const SOURCES = ["chunky", "credi", "cards", "costs"] as const;
export type Source = (typeof SOURCES)[number];
export const INITIAL: Record<Source, number> = {
  chunky: 702434,
  credi: 134900,
  cards: 800308,
  costs: 177358,
};
export const LABELS: Record<Source, string> = {
  chunky: "Chunky Bites",
  credi: "CrediJamar",
  cards: "Tarjetas personales",
  costs: "Costos / otros",
};
export type MoveType =
  | "REGULAR"
  | "CREDI"
  | "EXTRA_CREDI"
  | "EXTRA_CHUNKY"
  | "EXTRA_CARDS"
  | "EXTRA_COSTS"
  | "NO_PAYMENT";
export type Parameters = {
  effectivePeriod: string;
  interest: string;
  feci: string;
  regular: number;
  chunky: number;
  credi: number;
  firstDue: string;
  provisional: boolean;
  salary: number;
  salaryIncludesLoan: boolean;
  originalFirstDue?: string;
  originalProvisional?: boolean;
};
export const DEFAULT: Parameters = {
  effectivePeriod: "2026-10",
  interest: "0.095",
  feci: "0.01",
  regular: 31760,
  chunky: 17124,
  credi: 6256,
  firstDue: "2026-10-15",
  provisional: true,
  salary: 131092,
  salaryIncludesLoan: false,
};
export type Movement = {
  id: string;
  date: string;
  period: string;
  type: MoveType;
  amount: number;
  notes?: string;
};
export type Statement = {
  period: string;
  interest: number | null;
  feci: number | null;
  other: number | null;
  concept: string;
  principal: number | null;
  balance: number | null;
};
export type Bag = {
  capital: number;
  interest: number;
  feci: number;
  other: number;
  paidInterest: number;
  paidFeci: number;
  paidOther: number;
  amortized: number;
  closedOn: string | null;
};
export type Allocation = {
  source: Source;
  principal: number;
  interest: number;
  feci: number;
  other: number;
  compensation: number;
  advance: number;
};
export type Application = {
  id: string;
  date: string;
  period: string;
  type: MoveType;
  amount: number;
  principal: number;
  interest: number;
  feci: number;
  other: number;
  excess: number;
  compensation: number;
  advance: number;
  pendingAdvance: number;
  allocations: Allocation[];
};
export type SourcePeriod = {
  opening: number;
  interest: number;
  feci: number;
  other: number;
  principal: number;
  closing: number;
  pendingInterest: number;
  pendingFeci: number;
  pendingOther: number;
};
export type Period = {
  period: string;
  date: string;
  opening: number;
  interest: number;
  feci: number;
  other: number;
  principal: number;
  regular: number;
  credi: number;
  extras: number;
  closing: number;
  sources: Record<Source, SourcePeriod> | null;
  confirmed: boolean;
  status: "recorded" | "no-payment" | "unknown";
  bankBalance: number | null;
  balanceDifference: number | null;
  principalDifference: number | null;
};
export type Ledger = {
  bags: Record<Source, Bag>;
  asOf: string | null;
  advance: number;
  paid: number;
  principal: number;
  regularPrincipal: number;
  extraPrincipal: number;
  excess: number;
  applications: Application[];
  periods: Period[];
  warnings: string[];
  cashCompensations?: {
    id: string;
    date: string;
    amount: number;
    applied: number;
    excess: number;
  }[];
};
export function applyCashCompensations(
  l: Ledger,
  items: { id: string; date: string; amount: number }[],
) {
  l.cashCompensations = [];
  for (const item of [...items].sort((a, b) => a.date.localeCompare(b.date))) {
    const applied = Math.min(item.amount, l.advance);
    l.advance -= applied;
    const excess = item.amount - applied;
    l.cashCompensations.push({ ...item, applied, excess });
    if (excess)
      l.warnings.push(
        `Compensación en efectivo ${item.id}: ${money(excess)} USD recibidos sin adelanto pendiente que los justifique. Revisa o anula su aplicación; el aporte recibido se conserva.`,
      );
    if (sourceDebt(l, "credi") === 0 && !l.bags.credi.closedOn)
      l.bags.credi.closedOn = item.date;
  }
  return l;
}
export function cents(value: string | number) {
  const d = new Decimal(value).mul(100);
  if (!d.isInteger() || d.abs().gt(Number.MAX_SAFE_INTEGER))
    throw new Error("Importe inválido: usa dos decimales.");
  return d.toNumber();
}
export function money(n: number) {
  return new Decimal(n).div(100).toFixed(2);
}
export function sum(ns: number[]) {
  return ns.reduce((a, b) => a + b, 0);
}
export function capital(l: Ledger) {
  return sum(SOURCES.map((s) => l.bags[s].capital));
}
export function pending(l: Ledger) {
  return sum(
    SOURCES.map((s) => l.bags[s].interest + l.bags[s].feci + l.bags[s].other),
  );
}
export function emptyLedger(): Ledger {
  return {
    bags: Object.fromEntries(
      SOURCES.map((s) => [
        s,
        {
          capital: INITIAL[s],
          interest: 0,
          feci: 0,
          other: 0,
          paidInterest: 0,
          paidFeci: 0,
          paidOther: 0,
          amortized: 0,
          closedOn: null,
        },
      ]),
    ) as Record<Source, Bag>,
    asOf: null,
    advance: 0,
    paid: 0,
    principal: 0,
    regularPrincipal: 0,
    extraPrincipal: 0,
    excess: 0,
    applications: [],
    periods: [],
    warnings: [],
  };
}
export function sourceDebt(l: Ledger, s: Source) {
  const b = l.bags[s];
  return (
    b.capital + b.interest + b.feci + b.other + (s === "credi" ? l.advance : 0)
  );
}
// Largest remainder with stable tie breaking: every actual allocation reconciles to the cent.
export function split(amount: number, weights: number[]): number[] {
  const total = sum(weights);
  if (!total) return weights.map(() => 0);
  const exact = weights.map((w) => new Decimal(amount).mul(w).div(total));
  const out = exact.map((x) => x.floor().toNumber());
  const order = exact
    .map((x, i) => ({ i, r: x.minus(out[i]) }))
    .sort((a, b) => b.r.comparedTo(a.r) || a.i - b.i);
  const missing = amount - sum(out);
  for (let i = 0; i < missing; i++) out[order[i % order.length].i]++;
  return out;
}
export function monthIndex(period: string) {
  const [y, m] = period.split("-").map(Number);
  return y * 12 + m - 1;
}
export function monthAt(index: number) {
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}
export function addMonths(period: string, n: number) {
  return monthAt(monthIndex(period) + n);
}
export function dueDate(firstDue: string, period: string) {
  const [y, m] = period.split("-").map(Number);
  const day = Math.min(
    Number(firstDue.slice(8, 10)),
    new Date(Date.UTC(y, m, 0)).getUTCDate(),
  );
  return `${period}-${String(day).padStart(2, "0")}`;
}
export function panamaToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Panama",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
export function paramsAt(versions: Parameters[], period: string) {
  return (
    [...versions]
      .filter((v) => v.effectivePeriod <= period)
      .sort((a, b) => a.effectivePeriod.localeCompare(b.effectivePeriod))
      .at(-1) ||
    versions[0] ||
    DEFAULT
  );
}
export function accrue(
  l: Ledger,
  period: string,
  p: Parameters,
  statement?: Statement,
  status: Period["status"] = "unknown",
) {
  const opening = capital(l);
  const weights = SOURCES.map((s) => l.bags[s].capital);
  const interest =
    statement?.interest ??
    new Decimal(opening).mul(p.interest).div(12).toDecimalPlaces(0).toNumber();
  const feci =
    statement?.feci ??
    new Decimal(opening).mul(p.feci).div(12).toDecimalPlaces(0).toNumber();
  const other = statement?.other ?? 0;
  if (!opening && (interest || feci || other))
    l.warnings.push(
      `${period}: cargos confirmados con capital cero; requieren revisión, no se reasignaron.`,
    );
  const wi = opening ? weights : SOURCES.map((s) => INITIAL[s]);
  const ints = split(interest, wi),
    fecis = split(feci, wi),
    others = split(other, wi);
  SOURCES.forEach((s, i) => {
    l.bags[s].interest += ints[i];
    l.bags[s].feci += fecis[i];
    l.bags[s].other += others[i];
  });
  const sources = Object.fromEntries(
    SOURCES.map((s, i) => [
      s,
      {
        opening: weights[i],
        interest: ints[i],
        feci: fecis[i],
        other: others[i],
        principal: 0,
        closing: weights[i],
        pendingInterest: l.bags[s].interest,
        pendingFeci: l.bags[s].feci,
        pendingOther: l.bags[s].other,
      },
    ]),
  ) as Record<Source, SourcePeriod>;
  const row: Period = {
    period,
    date: dueDate(p.firstDue, period),
    opening,
    interest,
    feci,
    other,
    principal: 0,
    regular: 0,
    credi: 0,
    extras: 0,
    closing: opening,
    sources,
    confirmed: !!statement,
    status,
    bankBalance: statement?.balance ?? null,
    balanceDifference: null,
    principalDifference: null,
  };
  l.periods.push(row);
  return row;
}
function blankAllocations(): Allocation[] {
  return SOURCES.map((source) => ({
    source,
    principal: 0,
    interest: 0,
    feci: 0,
    other: 0,
    compensation: 0,
    advance: 0,
  }));
}
function applyPrincipal(
  l: Ledger,
  s: Source,
  n: number,
  a: Allocation[],
  date: string,
) {
  const actual = Math.min(n, l.bags[s].capital);
  l.bags[s].capital -= actual;
  l.bags[s].amortized += actual;
  a.find((x) => x.source === s)!.principal += actual;
  return actual;
}
function personalCapital(
  l: Ledger,
  n: number,
  a: Allocation[],
  date: string,
  compensation = false,
) {
  const available = l.bags.cards.capital + l.bags.costs.capital;
  const amounts = split(Math.min(n, available), [
    l.bags.cards.capital,
    l.bags.costs.capital,
  ]);
  (["cards", "costs"] as const).forEach((s, i) => {
    applyPrincipal(l, s, amounts[i], a, date);
    if (compensation) a.find((x) => x.source === s)!.compensation += amounts[i];
  });
  return sum(amounts);
}
export function apply(l: Ledger, m: Movement, p: Parameters): Application {
  const a = blankAllocations();
  let left = m.amount,
    compensation = 0,
    advance = 0;
  const row = l.periods.find((x) => x.period === m.period);
  if (!row) throw new Error("Falta devengo del período.");
  if (m.type === "NO_PAYMENT") {
    if (m.amount !== 0)
      throw new Error("Sin pago confirmado debe tener importe cero.");
  } else if (m.type === "REGULAR") {
    if (row.regular + m.amount > p.regular)
      l.warnings.push(
        `${m.period}: pago regular mayor que la referencia. Revisa el importe y registra los extras con destino explícito.`,
      );
    for (const field of ["interest", "feci", "other"] as const) {
      const dues = SOURCES.map((s) => l.bags[s][field]);
      const paid = Math.min(left, sum(dues));
      const parts = split(paid, dues);
      SOURCES.forEach((s, i) => {
        l.bags[s][field] -= parts[i];
        a[i][field] += parts[i];
        const paidField =
          field === "interest"
            ? "paidInterest"
            : field === "feci"
              ? "paidFeci"
              : "paidOther";
        l.bags[s][paidField] += parts[i];
      });
      left -= paid;
    }
    advance = a[1].interest + a[1].feci + a[1].other;
    l.advance += advance;
    a[1].advance = advance;
    const previousChunky = l.applications
      .filter((x) => x.period === m.period && x.type === "REGULAR")
      .flatMap((x) => x.allocations.filter((a) => a.source === "chunky"));
    const chunkyPaidCharges =
      sum(previousChunky.map((x) => x.interest + x.feci + x.other)) +
      a[0].interest +
      a[0].feci +
      a[0].other;
    const alreadyApplied = sum(previousChunky.map((x) => x.principal));
    const share = l.bags.chunky.capital
      ? new Decimal(Math.min(row.regular + m.amount, p.regular))
          .mul(p.chunky)
          .div(p.regular)
          .toDecimalPlaces(0)
          .toNumber()
      : 0;
    const chunkyPrincipal = applyPrincipal(
      l,
      "chunky",
      Math.min(left, Math.max(0, share - chunkyPaidCharges - alreadyApplied)),
      a,
      m.date,
    );
    left -= chunkyPrincipal;
    left -= personalCapital(l, left, a, m.date);
    // Remaining money is explicit excess; never assign it to another debt silently.
    row.regular += m.amount;
  } else if (m.type === "CREDI") {
    compensation = Math.min(
      left,
      l.advance,
      l.bags.cards.capital + l.bags.costs.capital,
    );
    compensation = personalCapital(l, compensation, a, m.date, true);
    l.advance -= compensation;
    left -= compensation;
    left -= applyPrincipal(l, "credi", left, a, m.date);
    row.credi += m.amount;
    if (l.bags.credi.interest + l.bags.credi.feci + l.bags.credi.other > 0)
      l.warnings.push(
        `${m.period}: cuota CrediJamar aplicada a capital; sus cargos siguen pendientes porque aún no fueron financiados. No se creó un adelanto ficticio.`,
      );
  } else {
    const destination: Source =
      m.type === "EXTRA_CREDI"
        ? "credi"
        : m.type === "EXTRA_CHUNKY"
          ? "chunky"
          : m.type === "EXTRA_CARDS"
            ? "cards"
            : "costs";
    left -= applyPrincipal(l, destination, left, a, m.date);
    row.extras += m.amount;
  }
  const principal = sum(a.map((x) => x.principal)),
    interest = sum(a.map((x) => x.interest)),
    feci = sum(a.map((x) => x.feci)),
    other = sum(a.map((x) => x.other));
  for (const s of SOURCES)
    if (sourceDebt(l, s) === 0 && l.bags[s].closedOn === null)
      l.bags[s].closedOn = m.date;
  const application: Application = {
    id: m.id,
    date: m.date,
    period: m.period,
    type: m.type,
    amount: m.amount,
    principal,
    interest,
    feci,
    other,
    excess: left,
    compensation,
    advance,
    pendingAdvance: l.advance,
    allocations: a,
  };
  l.paid += m.amount;
  l.principal += principal;
  l.excess += left;
  if (m.type === "REGULAR") l.regularPrincipal += principal;
  else l.extraPrincipal += principal;
  row.principal += principal;
  row.closing = capital(l);
  l.applications.push(application);
  if (row.sources)
    for (const s of SOURCES) {
      const x = row.sources[s],
        b = l.bags[s];
      x.principal += a.find((a) => a.source === s)!.principal;
      x.closing = b.capital;
      x.pendingInterest = b.interest;
      x.pendingFeci = b.feci;
      x.pendingOther = b.other;
    }
  if (left)
    l.warnings.push(
      `${m.period}: ${money(left)} USD de exceso sin aplicar. Requiere devolución/corrección o un movimiento nuevo con destino explícito.`,
    );
  return application;
}
export function replay(
  movements: Movement[],
  statements: Statement[] = [],
  versions: Parameters[] = [DEFAULT],
  asOf = panamaToday(),
): Ledger {
  const l = emptyLedger();
  l.asOf = asOf;
  const start = versions[0].firstDue.slice(0, 7);
  let end =
    asOf >= dueDate(versions[0].firstDue, asOf.slice(0, 7))
      ? asOf.slice(0, 7)
      : addMonths(asOf.slice(0, 7), -1);
  for (const m of movements) if (m.period > end) end = m.period;
  for (const st of statements) if (st.period > end) end = st.period;
  if (monthIndex(end) - monthIndex(start) > 240)
    throw new Error("El horizonte máximo es 240 meses.");
  for (let i = monthIndex(start); i <= monthIndex(end); i++) {
    const period = monthAt(i),
      p = paramsAt(versions, period),
      st = statements.find((x) => x.period === period);
    const ms = movements.filter((x) => x.period === period);
    const status = ms.some((x) => x.type !== "NO_PAYMENT")
      ? "recorded"
      : ms.length
        ? "no-payment"
        : "unknown";
    const row = accrue(l, period, p, st, status);
    // Caller preserves database creation order for same-day movements, including funding before compensation.
    for (const m of ms.sort((a, b) => a.date.localeCompare(b.date)))
      apply(l, m, p);
    row.closing = capital(l);
    if (st?.balance !== null && st?.balance !== undefined)
      row.balanceDifference = row.closing - st.balance;
    if (st?.principal !== null && st?.principal !== undefined)
      row.principalDifference = row.principal - st.principal;
  }
  return l;
}
export type Forecast = {
  payments: number;
  closeDate: string | null;
  interest: number;
  feci: number;
  other: number;
  pendingAtEnd: number;
  capitalAtEnd: number;
  sections: Record<
    Source,
    {
      closeDate: string | null;
      deadline: string | null;
      remainingAtDeadline: number;
      extraNow: number;
    }
  >;
  schedule: Period[];
  lastPayment: number;
  warnings: string[];
};
type Extra = { period: string; source: Source; amount: number };
function projectRaw(
  real: Ledger,
  versions: Parameters[],
  withCredi: boolean,
  extras: Extra[] = [],
): Forecast {
  const l: Ledger = structuredClone(real);
  const before = {
    i: sum(SOURCES.map((s) => l.bags[s].paidInterest)),
    f: sum(SOURCES.map((s) => l.bags[s].paidFeci)),
    o: sum(SOURCES.map((s) => l.bags[s].paidOther)),
  };
  const first = versions[0].firstDue;
  const start = first.slice(0, 7);
  const next = real.periods.length
    ? addMonths(real.periods.at(-1)!.period, 1)
    : start;
  const sections = Object.fromEntries(
    SOURCES.map((s) => [
      s,
      {
        closeDate: l.bags[s].closedOn,
        deadline:
          s === "chunky"
            ? "2031-06-02"
            : s === "credi"
              ? dueDate(first, addMonths(start, 23))
              : null,
        remainingAtDeadline: 0,
        extraNow: 0,
      },
    ]),
  ) as Forecast["sections"];
  const schedule: Period[] = [];
  let payments = 0,
    lastPayment = 0;
  let checkedChunky = false,
    checkedCredi = false;
  // Deadlines already reached are evaluated from the real trajectory, never extended.
  for (const s of ["chunky", "credi"] as const) {
    const deadline = sections[s].deadline!;
    if (dueDate(first, next) > deadline) {
      if (real.asOf && real.asOf >= deadline) {
        const onTime = real.applications.filter((a) => a.date <= deadline);
        const principalAtLimit =
          INITIAL[s] -
          sum(
            onTime.flatMap((a) =>
              a.allocations
                .filter((x) => x.source === s)
                .map((x) => x.principal),
            ),
          );
        const advanceAtLimit =
          s === "credi"
            ? sum(onTime.map((a) => a.advance - a.compensation)) -
              sum(
                (real.cashCompensations || [])
                  .filter((x) => x.date <= deadline)
                  .map((x) => x.applied),
              )
            : 0;
        sections[s].remainingAtDeadline = Math.max(
          0,
          principalAtLimit + advanceAtLimit,
        );
      } else sections[s].remainingAtDeadline = sourceDebt(l, s);
      if (s === "chunky") checkedChunky = true;
      else checkedCredi = true;
    }
  }
  for (let i = 0; i < 240 && (capital(l) > 0 || pending(l) > 0); i++) {
    const period = addMonths(next, i),
      p = paramsAt(versions, period),
      date = dueDate(first, period),
      ordinal = monthIndex(period) - monthIndex(start);
    if (!checkedChunky && date > "2031-06-02") {
      sections.chunky.remainingAtDeadline =
        l.bags.chunky.capital +
        l.bags.chunky.interest +
        l.bags.chunky.feci +
        l.bags.chunky.other;
      checkedChunky = true;
    }
    const row = accrue(l, period, p);
    schedule.push(row);
    const regular = Math.min(p.regular, capital(l) + pending(l));
    const ar = apply(
      l,
      {
        id: `projection-regular-${period}`,
        date,
        period,
        type: "REGULAR",
        amount: regular,
      },
      p,
    );
    // The legal-only base is a bank counterfactual, not the fixed internal responsibility plan.
    if (!withCredi && ar.excess) {
      const n = applyPrincipal(l, "credi", ar.excess, ar.allocations, date);
      ar.principal += n;
      ar.excess -= n;
      l.principal += n;
      l.regularPrincipal += n;
      l.excess -= n;
      row.principal += n;
      row.closing = capital(l);
      if (row.sources) {
        row.sources.credi.principal += n;
        row.sources.credi.closing = l.bags.credi.capital;
      }
    }
    if (regular) {
      payments++;
      lastPayment = regular - ar.excess;
    }
    if (withCredi && ordinal < 24 && (l.bags.credi.capital || l.advance)) {
      const quota =
        ordinal === 23
          ? Math.min(p.credi + 5, l.bags.credi.capital + l.advance)
          : Math.min(p.credi, l.bags.credi.capital + l.advance);
      const ac = apply(
        l,
        {
          id: `projection-credi-${period}`,
          date,
          period,
          type: "CREDI",
          amount: quota,
        },
        p,
      );
      lastPayment += quota - ac.excess;
    }
    for (const extra of extras.filter((x) => x.period === period)) {
      const type: MoveType =
        extra.source === "chunky"
          ? "EXTRA_CHUNKY"
          : extra.source === "credi"
            ? "EXTRA_CREDI"
            : extra.source === "cards"
              ? "EXTRA_CARDS"
              : "EXTRA_COSTS";
      apply(
        l,
        {
          id: `simulation-${period}-${extra.source}`,
          date,
          period,
          type,
          amount: extra.amount,
        },
        p,
      );
    }
    for (const s of SOURCES) {
      if (!sections[s].closeDate && sourceDebt(l, s) === 0)
        sections[s].closeDate = date;
    }
    if (!checkedCredi && ordinal === 23) {
      sections.credi.remainingAtDeadline =
        l.bags.credi.capital +
        l.advance +
        l.bags.credi.interest +
        l.bags.credi.feci +
        l.bags.credi.other;
      checkedCredi = true;
    }
    row.closing = capital(l);
  }
  if (!checkedCredi && sourceDebt(l, "credi") > 0)
    sections.credi.remainingAtDeadline = sourceDebt(l, "credi");
  const warnings: string[] = [];
  if (sections.credi.remainingAtDeadline > 0)
    warnings.push("ERROR: CREDIJAMAR DEBE ESTAR LIQUIDADO EN 24 MESES");
  if (sections.chunky.remainingAtDeadline > 0)
    warnings.push(
      "Chunky necesita un abono adicional para liquidarse como máximo el 02/06/2031.",
    );
  return {
    payments,
    closeDate:
      capital(l) === 0 && pending(l) === 0
        ? schedule.at(-1)?.date ||
          real.applications
            .filter((a) => a.principal + a.interest + a.feci + a.other > 0)
            .at(-1)?.date ||
          null
        : null,
    interest: sum(SOURCES.map((s) => l.bags[s].paidInterest)) - before.i,
    feci: sum(SOURCES.map((s) => l.bags[s].paidFeci)) - before.f,
    other: sum(SOURCES.map((s) => l.bags[s].paidOther)) - before.o,
    pendingAtEnd: pending(l),
    capitalAtEnd: capital(l),
    sections,
    schedule,
    lastPayment,
    warnings,
  };
}
export function forecast(
  real: Ledger,
  versions: Parameters[] = [DEFAULT],
  withCredi = true,
  extras: Extra[] = [],
  calculateShortfall = true,
): Forecast {
  const result = projectRaw(real, versions, withCredi, extras);
  if (calculateShortfall) {
    for (const source of ["chunky", "credi"] as const) {
      if (!result.sections[source].remainingAtDeadline) continue;
      let lo = 0,
        hi = real.bags[source].capital;
      const next = real.periods.length
        ? addMonths(real.periods.at(-1)!.period, 1)
        : versions[0].firstDue.slice(0, 7);
      // Find an explicit up-front directed principal payment; pending charges/advances remain separate.
      while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2),
          copy = structuredClone(real);
        copy.bags[source].capital -= mid;
        const r = projectRaw(copy, versions, withCredi, extras);
        if (r.sections[source].remainingAtDeadline === 0) hi = mid;
        else lo = mid + 1;
      }
      result.sections[source].extraNow = lo;
      if (
        dueDate(versions[0].firstDue, next) > result.sections[source].deadline!
      )
        result.sections[source].extraNow = real.bags[source].capital;
    }
  }
  return result;
}
export function exactPayment(
  principal = "1349",
  months = 24,
  annual = "0.105",
) {
  const r = new Decimal(annual).div(12);
  return r.eq(0)
    ? new Decimal(principal).div(months)
    : new Decimal(principal)
        .mul(r)
        .div(new Decimal(1).minus(new Decimal(1).plus(r).pow(-months)));
}
export function crediReference() {
  const quota = exactPayment();
  let balance = new Decimal(1349);
  for (let i = 0; i < 23; i++)
    balance = balance
      .mul(new Decimal(1).plus(new Decimal(".105").div(12)))
      .minus("62.56");
  return {
    exact: quota.toFixed(8),
    proposed: 6256,
    last: cents(
      balance.mul(new Decimal(1).plus(new Decimal(".105").div(12))).toFixed(2),
    ),
    total: cents(quota.mul(24).toFixed(2)),
    charges: cents(quota.mul(24).minus(1349).toFixed(2)),
    original: 232800,
    implicitCost: 97900,
    saving: cents(new Decimal(2328).minus(quota.mul(24)).toFixed(2)),
  };
}
function totalCharges(l: Ledger, f: Forecast) {
  return (
    sum(
      SOURCES.map(
        (s) =>
          l.bags[s].paidInterest + l.bags[s].paidFeci + l.bags[s].paidOther,
      ),
    ) +
    f.interest +
    f.feci +
    f.other
  );
}
// Marginal bank impacts hold the reference CrediJamar cash schedule identical in both
// counterfactuals. This does not authorize reallocating a real contribution after payoff.
export function legalFuture(
  real: Ledger,
  versions: Parameters[],
  plan: Period[],
  extra?: Extra,
): Forecast {
  const template = forecast(real, versions, true, [], false);
  let balance = capital(real);
  let pi = sum(SOURCES.map((s) => real.bags[s].interest)),
    pf = sum(SOURCES.map((s) => real.bags[s].feci)),
    po = sum(SOURCES.map((s) => real.bags[s].other));
  let interest = 0,
    feci = 0,
    other = 0,
    payments = 0,
    lastPayment = 0;
  const schedule: Period[] = [];
  const first = versions[0].firstDue,
    next = real.periods.length
      ? addMonths(real.periods.at(-1)!.period, 1)
      : first.slice(0, 7);
  for (let i = 0; i < 240 && balance + pi + pf + po > 0; i++) {
    const period = addMonths(next, i),
      p = paramsAt(versions, period);
    const opening = balance;
    const ni = new Decimal(balance)
        .mul(p.interest)
        .div(12)
        .toDecimalPlaces(0)
        .toNumber(),
      nf = new Decimal(balance)
        .mul(p.feci)
        .div(12)
        .toDecimalPlaces(0)
        .toNumber();
    pi += ni;
    pf += nf;
    let left = Math.min(p.regular, balance + pi + pf + po);
    const paid = left;
    let n = Math.min(left, pi);
    pi -= n;
    left -= n;
    interest += n;
    n = Math.min(left, pf);
    pf -= n;
    left -= n;
    feci += n;
    n = Math.min(left, po);
    po -= n;
    left -= n;
    other += n;
    const regularPrincipal = Math.min(left, balance);
    balance -= regularPrincipal;
    const quota = Math.min(
      plan.find((x) => x.period === period)?.credi || 0,
      balance,
    );
    balance -= quota;
    const voluntary =
      extra?.period === period ? Math.min(extra.amount, balance) : 0;
    balance -= voluntary;
    if (paid) {
      payments++;
      lastPayment = paid + quota + voluntary;
    }
    schedule.push({
      period,
      date: dueDate(first, period),
      opening,
      interest: ni,
      feci: nf,
      other: 0,
      principal: regularPrincipal + quota + voluntary,
      regular: paid,
      credi: quota,
      extras: voluntary,
      closing: balance,
      sources: null,
      confirmed: false,
      status: "unknown",
      bankBalance: null,
      balanceDifference: null,
      principalDifference: null,
    });
  }
  return {
    ...template,
    payments,
    closeDate:
      balance + pi + pf + po === 0
        ? schedule.at(-1)?.date || real.periods.at(-1)?.date || null
        : null,
    interest,
    feci,
    other,
    capitalAtEnd: balance,
    pendingAtEnd: pi + pf + po,
    schedule,
    lastPayment,
  };
}
export function scenarios(
  movements: Movement[],
  statements: Statement[],
  versions: Parameters[],
  asOf: string,
  cashCompensations: { id: string; date: string; amount: number }[] = [],
) {
  const real = replay(movements, statements, versions, asOf),
    baseReal = replay(
      movements.filter((x) => x.type === "REGULAR" || x.type === "NO_PAYMENT"),
      statements,
      versions,
      asOf,
    ),
    habitReal = replay(
      movements.filter(
        (x) =>
          x.type === "REGULAR" || x.type === "CREDI" || x.type === "NO_PAYMENT",
      ),
      statements,
      versions,
      asOf,
    );
  applyCashCompensations(real, cashCompensations);
  applyCashCompensations(baseReal, cashCompensations);
  applyCashCompensations(habitReal, cashCompensations);
  const regular = forecast(emptyLedger(), versions, false, [], false),
    habitual = forecast(emptyLedger(), versions, true, [], false),
    current = forecast(real, versions, true);
  const baseRemaining = forecast(baseReal, versions, false, [], false),
    habitRemaining = forecast(habitReal, versions, true, [], false);
  const accumulated = {
    credi:
      totalCharges(baseReal, baseRemaining) -
      totalCharges(habitReal, habitRemaining),
    voluntary:
      totalCharges(habitReal, habitRemaining) - totalCharges(real, current),
    total: totalCharges(baseReal, baseRemaining) - totalCharges(real, current),
    months: baseRemaining.payments - current.payments,
  };
  const last = movements
    .filter((x) => x.type !== "REGULAR" && x.type !== "NO_PAYMENT")
    .at(-1);
  let lastImpact: null | {
    id: string;
    withoutCapital: number;
    withCapital: number;
    without: Forecast;
    with: Forecast;
    months: number;
    saving: number;
  } = null;
  if (last) {
    const withoutLedger = applyCashCompensations(
      replay(
        movements.filter((x) => x.id !== last.id),
        statements,
        versions,
        asOf,
      ),
      cashCompensations,
    );
    const reference = forecast(withoutLedger, versions, true, [], false),
      without = legalFuture(withoutLedger, versions, reference.schedule),
      withLast = legalFuture(real, versions, reference.schedule);
    lastImpact = {
      id: last.id,
      withoutCapital: capital(withoutLedger),
      withCapital: capital(real),
      without,
      with: withLast,
      months: without.payments - withLast.payments,
      saving:
        without.interest + without.feci - withLast.interest - withLast.feci,
    };
  }
  return {
    real,
    regular,
    habitual,
    current,
    baseRemaining,
    accumulated,
    lastImpact,
    crediReference: crediReference(),
    mathematicalPayment: cents(exactPayment("18150", 84).toFixed(2)),
  };
}
export function simulate(real: Ledger, versions: Parameters[], extra: Extra) {
  const reference = forecast(real, versions, true, [], false),
    without = legalFuture(real, versions, reference.schedule);
  const available =
    reference.schedule.find((x) => x.period === extra.period)?.sources?.[
      extra.source
    ].closing ?? 0;
  const applicable = Math.min(extra.amount, available),
    withExtra = legalFuture(real, versions, reference.schedule, {
      ...extra,
      amount: applicable,
    });
  return {
    without,
    with: withExtra,
    months: without.payments - withExtra.payments,
    saving:
      without.interest + without.feci - withExtra.interest - withExtra.feci,
    applicable,
    excess: extra.amount - applicable,
  };
}
