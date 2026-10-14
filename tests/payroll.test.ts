import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT,
  replay,
  forecast,
  sum,
  cents,
  scheduledDue,
} from "../src/lib/finance";
import {
  payrollExpected,
  suggestedAllocation,
  suggestedNextDue,
} from "../src/lib/payroll";
test("La quincena reparte el neto y conserva centavos; salario ya neto no descuenta dos veces", () => {
  const e = payrollExpected([DEFAULT], "2026-10", "1");
  assert.equal(e.received, 49666);
  assert.equal(e.deduction, 15880);
  assert.equal(e.chunky, 8562);
  assert.deepEqual(e.allocation, {
    NEEDS: "248.33",
    WANTS: "149.00",
    SAVINGS: "99.33",
  });
  for (let n = 0; n < 1000; n++)
    assert.equal(sum(Object.values(suggestedAllocation(n)).map(cents)), n);
  assert.equal(
    payrollExpected([{ ...DEFAULT, salaryIncludesLoan: true }], "2026-10", "1")
      .received,
    65546,
  );
  const odd = { ...DEFAULT, salary: 131093, regular: 31761 };
  assert.equal(
    payrollExpected([odd], "2026-10", "1").received +
      payrollExpected([odd], "2026-10", "2").received,
    99332,
  );
});
test("La deducción real anterior al primer vencimiento se aplica; la siguiente cuota vence el 16 de noviembre", () => {
  const p = { ...DEFAULT, firstDue: "2026-11-16", nextDue: "2026-11-16" };
  const a = {
    id: "first",
    date: "2026-10-14",
    period: "2026-10",
    type: "REGULAR" as const,
    amount: 15880,
  };
  const first = replay([a], [], [p], "2026-10-14");
  assert.equal(first.paid, 15880);
  assert.equal(first.applications.length, 1);
  assert.equal(first.periods[0].period, "2026-10");
  assert.equal(forecast(first, [p], false).schedule[0].date, "2026-11-16");
  assert.equal(
    sum(
      first.applications.flatMap((a) =>
        a.allocations
          .filter((x) => x.source === "credi")
          .map((x) => x.principal),
      ),
    ),
    0,
  );
  const two = replay(
    [a, { ...a, id: "second", date: "2026-10-30" }],
    [],
    [p],
    "2026-10-30",
  );
  assert.equal(two.paid, 31760);
  assert.equal(two.periods.length, 1);
  assert.equal(two.periods[0].interest, first.periods[0].interest);
  assert.equal(two.periods[0].feci, first.periods[0].feci);
  assert.ok(
    sum(
      two.applications.flatMap((a) =>
        a.allocations
          .filter((x) => x.source === "cards")
          .map((x) => x.principal),
      ),
    ) > 0,
  );
  assert.equal(suggestedNextDue([p], "2026-10-14", []), "2026-11-16");
  assert.equal(
    suggestedNextDue([p], "2026-11-30", [
      { status: "active", next_due: "2026-11-16" },
    ]),
    "2026-12-16",
  );
});

test("Los nuevos vencimientos mensuales conservan el día confirmado en meses anteriores", () => {
  const p = {
    ...DEFAULT,
    nextDue: "2026-12-17",
    scheduledDues: ["2026-11-16", "2026-12-17"],
  };
  assert.equal(scheduledDue(p, "2026-10"), "2026-10-15");
  assert.equal(scheduledDue(p, "2026-11"), "2026-11-16");
  assert.equal(scheduledDue(p, "2026-12"), "2026-12-17");
});
