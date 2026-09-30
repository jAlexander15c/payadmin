import { test } from "node:test";
import assert from "node:assert/strict";
import {
  INITIAL,
  DEFAULT,
  SOURCES,
  emptyLedger,
  capital,
  cents,
  sum,
  split,
  replay,
  forecast,
  crediReference,
  exactPayment,
  simulate,
  scenarios,
  applyCashCompensations,
  money,
  type Movement,
  type Parameters,
} from "../src/lib/finance";
const date = "2026-10-15",
  period = "2026-10";
function m(
  type: Movement["type"],
  amount: number,
  id: string = type,
): Movement {
  return { id, date, period, type, amount };
}
function ledger(ms: Movement[]) {
  return replay(ms, [], [DEFAULT], date);
}
test("Los cuadres iniciales conservan los números definitivos", () => {
  assert.equal(INITIAL.chunky + INITIAL.credi + INITIAL.cards, 1637642);
  assert.equal(sum(Object.values(INITIAL)), 1815000);
  assert.equal(142885 + 31760 + 2713, 177358);
  assert.equal(185531 + 362241 + 252536, 800308);
  assert.equal(112135 + 7849 + 150 + 1820 + 20931, 142885);
  assert.equal(17124 + 14636, 31760);
  assert.equal(5742 + 8562 + 8 * 17124, 151296);
  assert.equal(702434 - 695649, 6785);
  assert.equal(ledger([]).paid, 0);
});
test("El reparto conserva cada centavo, incluso en asignaciones pequeñas", () => {
  for (let amount = 0; amount < 1000; amount++) {
    const r = split(amount, [702434, 134900, 800308, 177358]);
    assert.equal(sum(r), amount);
    assert.ok(r.every((x) => Number.isInteger(x) && x >= 0));
  }
  assert.throws(() => cents("0.001"));
});
test("Cuota regular fija y compensación explícita de CrediJamar", () => {
  const regular = ledger([m("REGULAR", 31760)]),
    r = regular.applications[0];
  assert.equal(
    r.allocations[0].principal +
      r.allocations[0].interest +
      r.allocations[0].feci,
    17124,
  );
  assert.equal(r.amount, 31760);
  assert.equal(r.advance, 1180);
  assert.equal(regular.advance, 1180);
  const both = ledger([m("REGULAR", 31760), m("CREDI", 6256)]),
    extra = both.applications[1];
  assert.equal(extra.principal, 6256);
  assert.equal(extra.compensation, 1180);
  assert.equal(extra.allocations[1].principal, 5076);
  assert.equal(extra.interest + extra.feci, 0);
  assert.equal(
    extra.compensation + extra.allocations[1].principal,
    extra.principal,
  );
  assert.equal(both.advance, 0);
  assert.equal(both.paid, 38016);
  assert.equal(both.principal, 1815000 - capital(both));
});
test("CrediJamar: referencia aislada, 24 meses y último importe", () => {
  const r = crediReference();
  assert.equal(r.exact, "62.56128017");
  assert.equal(r.last, 6259);
  assert.equal(r.total, 150147);
  assert.equal(r.charges, 15247);
  assert.equal(r.saving, 82653);
  const f = forecast(emptyLedger());
  assert.equal(f.sections.credi.closeDate, "2028-09-15");
  assert.equal(f.sections.credi.remainingAtDeadline, 0);
  assert.equal(f.schedule.filter((x) => x.credi > 0).length, 24);
  assert.ok(Math.abs(f.schedule[23].credi - 6259) <= 5);
  const bad: Parameters = { ...DEFAULT, credi: 1000 };
  const fail = forecast(emptyLedger(), [bad]);
  assert.ok(fail.sections.credi.remainingAtDeadline > 0);
  assert.ok(
    fail.warnings.includes(
      "ERROR: CREDIJAMAR DEBE ESTAR LIQUIDADO EN 24 MESES",
    ),
  );
  assert.equal(
    fail.schedule.slice(24).reduce((s, r) => s + r.credi, 0),
    0,
  );
});
test("Chunky mantiene cuota y fecha límite; un extra adelanta su cierre", () => {
  const f = forecast(emptyLedger());
  assert.ok(f.sections.chunky.closeDate! <= "2031-06-02");
  assert.equal(f.sections.chunky.remainingAtDeadline, 0);
  const after = ledger([m("EXTRA_CHUNKY", 100000)]);
  assert.ok(
    forecast(after).sections.chunky.closeDate! < f.sections.chunky.closeDate!,
  );
  const missed = replay([m("NO_PAYMENT", 0)], [], [DEFAULT], "2030-10-15"),
    bad = forecast(missed);
  assert.ok(bad.sections.chunky.remainingAtDeadline > 0);
  assert.ok(bad.sections.chunky.extraNow > 0);
});
test("Abonos dirigidos reducen exclusivamente su fuente", () => {
  for (const [type, source] of [
    ["EXTRA_CHUNKY", "chunky"],
    ["EXTRA_CREDI", "credi"],
    ["EXTRA_CARDS", "cards"],
    ["EXTRA_COSTS", "costs"],
  ] as const) {
    const l = ledger([m(type, 20000)]);
    for (const s of SOURCES)
      assert.equal(l.bags[s].capital, INITIAL[s] - (s === source ? 20000 : 0));
    assert.equal(l.advance, 0);
  }
});
test("Pago cero confirmado, meses desconocidos, pago parcial y quincenas", () => {
  const zero = ledger([m("NO_PAYMENT", 0)]);
  assert.equal(zero.paid, 0);
  assert.equal(zero.periods[0].status, "no-payment");
  assert.ok(
    sum(SOURCES.map((s) => zero.bags[s].interest + zero.bags[s].feci)) > 0,
  );
  assert.equal(capital(zero), 1815000);
  assert.equal(ledger([]).periods[0].status, "unknown");
  const partial = ledger([m("REGULAR", 5000)]);
  assert.equal(partial.principal, 0);
  assert.ok(
    sum(SOURCES.map((s) => partial.bags[s].interest + partial.bags[s].feci)) >
      0,
  );
  assert.ok(partial.advance < 1180);
  const halves = ledger([
    m("REGULAR", 15880, "first"),
    { ...m("REGULAR", 15880, "second"), date: "2026-10-30" },
  ]);
  assert.equal(capital(halves), capital(ledger([m("REGULAR", 31760)])));
  assert.equal(
    halves.periods[0].interest,
    ledger([m("REGULAR", 31760)]).periods[0].interest,
  );
  assert.equal(halves.paid, 31760);
  assert.equal(
    halves.bags.chunky.capital,
    ledger([m("REGULAR", 31760)]).bags.chunky.capital,
  );
});
test("Ceros confirmados se conservan y diferencias del banco no alteran el capital", () => {
  const st = {
    period,
    interest: 0,
    feci: 0,
    other: 0,
    concept: "",
    principal: 0,
    balance: 1800000,
  };
  const l = replay([m("REGULAR", 31760)], [st], [DEFAULT], date);
  assert.equal(l.applications[0].interest + l.applications[0].feci, 0);
  assert.equal(l.principal, 31760);
  assert.equal(l.periods[0].balanceDifference, 1815000 - 31760 - 1800000);
  assert.equal(l.periods[0].principalDifference, 31760);
  const estimate = replay(
    [],
    [{ ...st, interest: null, feci: null }],
    [DEFAULT],
    date,
  );
  assert.ok(estimate.periods[0].interest > 0);
});
test("Sin financiación real no se reconoce adelanto; la compensación parcial es limitada", () => {
  const extra = ledger([m("CREDI", 6256)]);
  assert.equal(extra.advance, 0);
  assert.equal(extra.applications[0].compensation, 0);
  assert.ok(extra.bags.credi.interest > 0);
  const part = ledger([m("REGULAR", 5000), m("CREDI", 200)]);
  assert.equal(part.applications[1].compensation, 200);
  assert.equal(part.applications[1].allocations[1].principal, 0);
  assert.ok(part.advance > 0);
});
test("Cancelación anticipada, exceso y progreso por capital", () => {
  const l = ledger([m("EXTRA_CREDI", 200000)]);
  assert.equal(l.bags.credi.capital, 0);
  assert.equal(l.excess, 65100);
  assert.equal(l.bags.credi.amortized / INITIAL.credi, 1);
  assert.equal(l.paid, 200000);
  assert.equal(l.paid, l.principal + l.excess);
  const next = replay([m("EXTRA_CREDI", 200000)], [], [DEFAULT], "2026-11-15");
  assert.equal(next.bags.credi.paidInterest, 0);
  assert.equal(next.periods[1].opening, 1815000 - 134900);
});
test("Plazo oficial separado: cuota matemática ~306.02 y base de 80 pagos", () => {
  assert.ok(exactPayment("18150", 84).minus("306.02").abs().lt(".01"));
  assert.equal(forecast(emptyLedger(), [DEFAULT], false).payments, 80);
});
test("Extras de 200, 1000 y 500: ahorro marginal y acumulado sin sumar capital", () => {
  const a = simulate(emptyLedger(), [DEFAULT], {
      period,
      source: "cards",
      amount: 20000,
    }),
    b = simulate(emptyLedger(), [DEFAULT], {
      period,
      source: "cards",
      amount: 100000,
    });
  assert.ok(a.saving > 0);
  assert.ok(b.saving > a.saving);
  assert.ok(b.months >= a.months);
  assert.deepEqual(
    a.without.schedule.map((x) => x.credi).filter(Boolean),
    a.with.schedule.map((x) => x.credi).filter(Boolean),
  );
  const moves = [
    m("REGULAR", 31760),
    m("CREDI", 6256),
    m("EXTRA_CARDS", 20000, "200"),
    m("EXTRA_CHUNKY", 100000, "1000"),
    m("EXTRA_CARDS", 50000, "500"),
  ];
  const r = scenarios(moves, [], [DEFAULT], date);
  assert.ok(r.accumulated.voluntary > 0);
  assert.equal(
    r.accumulated.total,
    r.accumulated.credi + r.accumulated.voluntary,
  );
  assert.ok(r.lastImpact!.saving > 0);
});
test("Versiones futuras de tasa no reescriben el primer período", () => {
  const versions = [
    DEFAULT,
    { ...DEFAULT, effectivePeriod: "2026-11", interest: "0.11" },
  ];
  const l = replay([m("REGULAR", 31760)], [], versions, "2026-11-15");
  assert.equal(l.periods[0].interest, 14369);
  assert.ok(l.periods[1].interest > l.periods[0].interest);
});
test("Una liquidación tardía no borra el incumplimiento del límite", () => {
  const late = {
    id: "late",
    date: "2028-10-15",
    period: "2028-10",
    type: "EXTRA_CREDI" as const,
    amount: 134900,
  };
  const l = replay([late], [], [DEFAULT], "2028-10-15");
  const f = forecast(l);
  assert.ok(f.sections.credi.remainingAtDeadline >= 134900);
  assert.ok(
    f.warnings.includes("ERROR: CREDIJAMAR DEBE ESTAR LIQUIDADO EN 24 MESES"),
  );
});
test("Cancelación bancaria con reembolso interno separado y fecha límite conservada", () => {
  const moves = [m("REGULAR", 31760)];
  for (const s of SOURCES) {
    const l = ledger(moves);
    moves.push(
      m(
        (
          {
            chunky: "EXTRA_CHUNKY",
            credi: "EXTRA_CREDI",
            cards: "EXTRA_CARDS",
            costs: "EXTRA_COSTS",
          } as const
        )[s],
        l.bags[s].capital,
        s,
      ),
    );
  }
  const l = ledger(moves),
    bankPaid = l.paid;
  assert.equal(capital(l), 0);
  assert.equal(l.advance, 1180);
  assert.equal(l.bags.credi.closedOn, null);
  assert.equal(forecast(l).sections.credi.remainingAtDeadline, 1180);
  applyCashCompensations(l, [
    { id: "cash", date: "2026-10-20", amount: cents("11.80") },
  ]);
  assert.equal(l.advance, 0);
  assert.equal(l.paid, bankPaid);
  assert.equal(l.principal, 1815000);
  assert.equal(l.bags.credi.closedOn, "2026-10-20");
  assert.equal(forecast(l).sections.credi.remainingAtDeadline, 0);
  assert.equal(forecast(l).closeDate, date);
  const late = replay(moves, [], [DEFAULT], "2028-10-20");
  applyCashCompensations(late, [
    { id: "late-cash", date: "2028-10-20", amount: 1180 },
  ]);
  assert.equal(forecast(late).sections.credi.remainingAtDeadline, 1180);
  const excess = ledger(moves);
  applyCashCompensations(excess, [
    { id: "excess", date: "2026-10-20", amount: 2000 },
  ]);
  assert.equal(excess.advance, 0);
  assert.equal(money(excess.cashCompensations![0].excess), "8.20");
});
