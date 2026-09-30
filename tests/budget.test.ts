import { test } from "node:test";
import assert from "node:assert/strict";
import { budgetFor } from "../src/lib/budget";
import { DEFAULT, emptyLedger, forecast } from "../src/lib/finance";
function data() {
  return {
    versions: [DEFAULT],
    real: emptyLedger(),
    current: forecast(emptyLedger()),
    contributions: [],
    cash: [],
    rawMovements: [],
    participants: [],
  };
}
test("Presupuesto quincenal: importes definitivos y escenario 100% explícito", () => {
  const b = budgetFor(data(), "2026-10", "1");
  assert.equal(b.gross, 65546);
  assert.equal(b.regular, 15880);
  assert.equal(b.net, 49666);
  assert.equal(b.chunky, 8562);
  assert.equal(b.availableAfterExpected, 58228);
  assert.equal(b.load, 7318);
  assert.equal(b.room, 5791);
  assert.equal(b.scenarioCredi, 3128);
  assert.equal(b.scenarioLiquid, 2663);
  assert.equal(b.myCredi, null);
  assert.equal(b.actualCash, 0);
  assert.deepEqual(
    b.distribution.map((x) => x.amount),
    [32773, 19664, 13109],
  );
});
test("Referencia mensual 50/30/20 y salario ya neto sin doble descuento", () => {
  const d = data(),
    monthly = budgetFor(d, "2026-10", "all");
  assert.deepEqual(
    monthly.distribution.map((x) => x.amount),
    [65546, 39328, 26218],
  );
  d.versions = [{ ...DEFAULT, salaryIncludesLoan: true }];
  const b = budgetFor(d, "2026-10", "1");
  assert.equal(b.net, 65546);
});
test("Caja real incorpora solo efectivo recibido y resta extras una vez", () => {
  const d: any = data();
  d.cash = [
    {
      date: "2026-10-15",
      period: "2026-10",
      status: "active",
      kind: "PAYROLL",
      amount: "496.66",
    },
  ];
  d.contributions = [
    {
      date: "2026-10-01",
      period: "2026-10",
      status: "active",
      source_id: "chunky",
      amount: "85.62",
    },
  ];
  d.rawMovements = [
    {
      date: "2026-10-15",
      period: "2026-10",
      status: "active",
      type: "REGULAR",
      amount: "158.80",
    },
    {
      date: "2026-10-15",
      period: "2026-10",
      status: "active",
      type: "CREDI",
      amount: "31.28",
    },
  ];
  const b = budgetFor(d, "2026-10", "1");
  assert.equal(b.actualCash, 55100);
  assert.equal(b.contributions[0].pending, 0);
  assert.equal(b.contributions[1].pending, 3128);
});
test("Mes anterior al inicio no descuenta el nuevo BG ni espera aportes", () => {
  const b = budgetFor(data(), "2026-09", "all");
  assert.equal(b.regular, 0);
  assert.equal(b.chunky, 0);
  assert.equal(b.net, 131092);
});
test("Las dos quincenas conservan centavos cuando cambia a un salario impar", () => {
  const d = data();
  d.versions = [{ ...DEFAULT, salary: 131091 }];
  const a = budgetFor(d, "2026-10", "1"),
    b = budgetFor(d, "2026-10", "2"),
    month = budgetFor(d, "2026-10", "all");
  assert.equal(a.gross + b.gross, month.gross);
  assert.equal(
    month.distribution.reduce((s, x) => s + x.amount, 0),
    month.gross,
  );
});
test("Caja usa fecha efectiva; aportes esperados usan el período de responsabilidad", () => {
  const d: any = data();
  d.contributions = [
    {
      date: "2026-09-30",
      period: "2026-10",
      status: "active",
      source_id: "chunky",
      amount: "171.24",
    },
  ];
  assert.equal(budgetFor(d, "2026-09", "all").actualCash, 17124);
  const oct = budgetFor(d, "2026-10", "all");
  assert.equal(oct.actualCash, 0);
  assert.equal(oct.contributions[0].received, 17124);
});
