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
test("Fijos reservan presupuesto sin crear pagos; parciales liberan reserva sin duplicarla", () => {
  const d: any = data();
  d.fixedExpenses = [
    {
      fixed_id: "rent",
      effective_period: "2026-10",
      name: "Alquiler",
      amount: "300.00",
      due_day: 5,
      active: true,
    },
  ];
  const before = budgetFor(d, "2026-10", "1");
  assert.equal(before.actualCash, 0);
  assert.equal(before.categories[0].remaining, 2773);
  d.cash = [
    {
      date: "2026-10-03",
      period: "2026-10",
      kind: "EXPENSE",
      category: "NEEDS",
      funding: "CASH",
      fixed_expense_id: "rent",
      amount: "100.00",
      status: "active",
    },
  ];
  const after = budgetFor(d, "2026-10", "1");
  assert.equal(after.fixed[0].paid, 10000);
  assert.equal(after.fixed[0].pending, 20000);
  assert.equal(after.categories[0].remaining, before.categories[0].remaining);
  assert.equal(after.actualCash, -10000);
  d.cash[0].status = "void";
  assert.equal(budgetFor(d, "2026-10", "1").fixed[0].paid, 0);
});
test("Gasto desde ahorro acumulado no sale de caja ni consume dos veces la asignación mensual", () => {
  const d: any = data();
  d.cash = [
    {
      date: "2026-09-01",
      kind: "SAVINGS_OPENING",
      amount: "200.00",
      status: "active",
    },
    { date: "2026-09-15", kind: "SAVING", amount: "50.00", status: "active" },
    {
      date: "2026-10-01",
      kind: "EXPENSE",
      category: "WANTS",
      funding: "SAVINGS",
      amount: "70.00",
      status: "active",
    },
    {
      date: "2026-10-01",
      kind: "EXPENSE",
      category: "WANTS",
      funding: "CASH",
      amount: "25.00",
      status: "active",
    },
    {
      date: "2026-10-20",
      kind: "SAVING",
      category: "SAVINGS",
      amount: "20.00",
      status: "active",
    },
  ];
  const a = budgetFor(d, "2026-10", "1"),
    b = budgetFor(d, "2026-10", "2"),
    month = budgetFor(d, "2026-10", "all");
  assert.equal(a.savingsBefore, 25000);
  assert.equal(a.savingsSpent, 7000);
  assert.equal(a.savingsBalance, 18000);
  assert.equal(a.actualCash, -2500);
  assert.equal(a.categories[1].used, 2500);
  assert.equal(b.savingsBefore, a.savingsBalance);
  assert.equal(b.savingsBalance, 20000);
  assert.equal(month.savingsBalance, b.savingsBalance);
  assert.equal(a.actualCash + b.actualCash, month.actualCash);
});
test("Saldo previo de ahorro no inventa ingreso de caja ni consume el ahorro del mes", () => {
  const d: any = data();
  d.cash = [
    {
      date: "2026-10-01",
      kind: "SAVINGS_OPENING",
      category: "SAVINGS",
      amount: "1000.00",
      status: "active",
    },
  ];
  const b = budgetFor(d, "2026-10", "all");
  assert.equal(b.savingsBalance, 100000);
  assert.equal(b.income, 0);
  assert.equal(b.actualCash, 0);
  assert.equal(b.categories[2].used, 0);
});
test("Personal y ahorro/deuda incluyen salidas reales, muestran sobregiro y mantienen BG voluntario", () => {
  const d: any = data();
  d.cash = [
    {
      date: "2026-10-02",
      kind: "EXPENSE",
      category: "WANTS",
      amount: "500.00",
      status: "active",
    },
    {
      date: "2026-10-02",
      kind: "SAVING",
      category: "SAVINGS",
      amount: "10.00",
      status: "active",
    },
    {
      date: "2026-10-02",
      kind: "EXPENSE",
      category: "SAVINGS",
      amount: "5.00",
      status: "active",
    },
  ];
  d.rawMovements = [
    { date: "2026-10-01", status: "active", type: "REGULAR", amount: "158.80" },
    { date: "2026-10-01", status: "active", type: "CREDI", amount: "31.28" },
  ];
  const b = budgetFor(d, "2026-10", "1");
  assert.equal(b.categories[1].remaining, 19664 - 50000);
  assert.equal(b.categories[2].used, 1000 + 500 + 3128);
  assert.equal(b.categories[2].remaining, 5791 - 4628);
});
test("Vigencia mensual, baja y vencimientos en febrero conservan los compromisos históricos", () => {
  const d: any = data();
  d.fixedExpenses = [
    {
      fixed_id: "internet",
      effective_period: "2026-10",
      name: "Internet",
      amount: "30.00",
      due_day: 31,
      active: true,
    },
    {
      fixed_id: "internet",
      effective_period: "2027-01",
      name: "Internet",
      amount: "40.00",
      due_day: 31,
      active: true,
    },
    {
      fixed_id: "internet",
      effective_period: "2027-03",
      name: "Internet",
      amount: "40.00",
      due_day: 31,
      active: false,
    },
  ];
  assert.equal(budgetFor(d, "2026-09", "all").fixed.length, 0);
  assert.equal(budgetFor(d, "2026-10", "all").fixedPending, 3000);
  assert.equal(budgetFor(d, "2027-02", "1").fixed.length, 0);
  const b = budgetFor(d, "2027-02", "2");
  assert.equal(b.fixed[0].dueDate, "2027-02-28");
  assert.equal(b.fixedPending, 4000);
  assert.equal(budgetFor(d, "2027-03", "all").fixed.length, 0);
});
test("Pago anticipado de fijo reserva por vencimiento y registra caja por fecha efectiva", () => {
  const d: any = data();
  d.fixedExpenses = [
    {
      fixed_id: "bill",
      effective_period: "2026-10",
      name: "Factura",
      amount: "30.00",
      due_day: 20,
      active: true,
    },
  ];
  d.cash = [
    {
      date: "2026-10-10",
      period: "2026-10",
      fixed_expense_id: "bill",
      kind: "EXPENSE",
      category: "NEEDS",
      amount: "30.00",
      status: "active",
    },
  ];
  assert.equal(budgetFor(d, "2026-10", "1").spent, 3000);
  assert.equal(budgetFor(d, "2026-10", "2").fixedPending, 0);
  assert.equal(budgetFor(d, "2026-10", "all").categories[0].used, 3000);
});
