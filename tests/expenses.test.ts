import { test } from "node:test";
import assert from "node:assert/strict";
import { expensesFor } from "../src/lib/expenses";
import { loanBudgetFor } from "../src/lib/budget";
import { DEFAULT, emptyLedger, forecast } from "../src/lib/finance";
const data = () => ({
  expenseCash: [] as any[],
  cash: [] as any[],
  fundAdjustments: [] as any[],
  fixedExpenses: [] as any[],
  versions: [DEFAULT],
  real: emptyLedger(),
  current: forecast(emptyLedger()),
  contributions: [],
  rawMovements: [],
  participants: [],
});
const entry = (
  id: string,
  kind: string,
  category: string,
  amount: string,
  date = "2026-10-02",
  status = "active",
) => ({
  id,
  kind,
  category,
  amount,
  date,
  status,
  period: date.slice(0, 7),
  concept: id,
  funding: "CASH",
  ledger: "EXPENSES",
});
test("Control de gastos: entradas y salidas por tres apartados, sin usar préstamo, planilla ni aportes", () => {
  const d = data();
  d.expenseCash = [
    entry("ingreso", "INCOME", "WANTS", "100.00"),
    entry("fijo", "EXPENSE", "NEEDS", "30.00"),
    entry("personal", "EXPENSE", "WANTS", "15.00"),
    entry("ahorro", "EXPENSE", "SAVINGS", "5.00"),
    entry("anulado", "EXPENSE", "WANTS", "999.00", "2026-10-02", "void"),
  ];
  d.cash = [
    { ...entry("planilla", "PAYROLL", "OTHER", "500.00"), ledger: "BUDGET" },
  ];
  const b = expensesFor(d, "2026-10", "all");
  assert.equal(b.income, 10000);
  assert.equal(b.spent, 5000);
  assert.equal(b.net, 5000);
  assert.deepEqual(
    b.categories.map((c) => c.spent),
    [3000, 1500, 500],
  );
  assert.deepEqual(
    b.categories.map((c) => c.share),
    [60, 30, 10],
  );
  assert.deepEqual(b.daily, [
    { date: "2026-10-02", income: 10000, spent: 5000 },
  ]);
  assert.equal(b.records.length, 5);
  assert.equal(loanBudgetFor(d, "2026-10", "all").actualCash, 50000);
});
test("Ajustes y saldo previo quedan fuera de consumo; ingresos/salidas de Mis totales se cuentan una vez", () => {
  const d = data();
  d.expenseCash = [
    entry("previo", "SAVINGS_OPENING", "SAVINGS", "200.00"),
    entry("apartado", "SAVING", "SAVINGS", "20.00"),
  ];
  d.fundAdjustments = [
    {
      id: "set",
      date: "2026-10-03",
      bucket: "WANTS",
      operation: "SET",
      effect: "ADJUSTMENT",
      amount: "50.00",
      delta: "50.00",
    },
    {
      id: "correccion",
      date: "2026-10-03",
      bucket: "WANTS",
      operation: "REMOVE",
      effect: "ADJUSTMENT",
      amount: "10.00",
      delta: "-10.00",
    },
    {
      id: "disponible",
      date: "2026-10-03",
      bucket: "WANTS",
      operation: "ADD",
      effect: "ALLOCATION",
      amount: "20.00",
      delta: "20.00",
    },
    {
      id: "extra",
      date: "2026-10-03",
      bucket: "WANTS",
      operation: "ADD",
      effect: "INCOME",
      amount: "30.00",
      delta: "30.00",
      reason: "Extra",
    },
    {
      id: "salida",
      date: "2026-10-03",
      bucket: "SAVINGS",
      operation: "REMOVE",
      effect: "EXPENSE",
      amount: "5.00",
      delta: "-5.00",
      reason: "Salida",
    },
  ];
  const b = expensesFor(d, "2026-10", "all");
  assert.equal(b.income, 3000);
  assert.equal(b.spent, 500);
  assert.equal(b.net, 2500);
  assert.equal(b.records.length, 4);
  assert.deepEqual(b.daily, [{ date: "2026-10-03", income: 3000, spent: 500 }]);
  const loan = loanBudgetFor(d, "2026-10", "all");
  assert.equal(loan.income, 0);
  assert.equal(loan.spent, 0);
  assert.equal(loan.savingsBalance, 0);
});
test("Las quincenas y meses filtran los gráficos por fecha real y conservan centavos", () => {
  const d = data();
  d.versions = [{ ...DEFAULT, salary: 131091 }];
  d.expenseCash = [
    entry("primera", "EXPENSE", "WANTS", "10.01", "2026-10-15"),
    entry("segunda", "INCOME", "NEEDS", "20.02", "2026-10-16"),
    entry("anterior", "EXPENSE", "NEEDS", "100.00", "2026-09-30"),
  ];
  const first = expensesFor(d, "2026-10", "1"),
    second = expensesFor(d, "2026-10", "2"),
    all = expensesFor(d, "2026-10", "all");
  assert.equal(first.spent, 1001);
  assert.equal(first.income, 0);
  assert.equal(second.income, 2002);
  assert.equal(second.spent, 0);
  assert.equal(first.salary + second.salary, all.salary);
  assert.deepEqual(
    first.categories.map(
      (c, i) => c.salaryReference + second.categories[i].salaryReference,
    ),
    all.categories.map((c) => c.salaryReference),
  );
  assert.equal(all.daily.length, 2);
  assert.equal(all.records.length, 2);
});
test("Referencias de consumo basadas solo en salario, incluso con grandes extras y préstamo activo", () => {
  const d = data(),
    before = expensesFor(d, "2026-10", "all");
  d.expenseCash = [
    entry("extra", "INCOME", "SAVINGS", "10000.00"),
    entry("consumo", "EXPENSE", "WANTS", "39.33"),
  ];
  const after = expensesFor(d, "2026-10", "all");
  assert.equal(after.salary, DEFAULT.salary);
  assert.deepEqual(
    after.categories.map((c) => c.salaryReference),
    before.categories.map((c) => c.salaryReference),
  );
  assert.deepEqual(
    after.categories.map((c) => c.salaryReference),
    [65546, 39328, 26218],
  );
  assert.ok(Math.abs(after.categories[1].salaryPercent! - 10) < 0.01);
  assert.equal(after.categories[2].salaryPercent, 0);
  assert.equal(after.categories[2].income, 1000000);
});
test("Fijos mensuales: parcial, anulación, pago anticipado, vigencia y vencimiento en febrero", () => {
  const d = data();
  d.fixedExpenses = [
    {
      fixed_id: "internet",
      effective_period: "2026-02",
      name: "Internet",
      amount: "40.00",
      due_day: 31,
      active: true,
    },
    {
      fixed_id: "internet",
      effective_period: "2026-03",
      name: "Internet",
      amount: "50.00",
      due_day: 31,
      active: false,
    },
  ];
  d.expenseCash = [
    {
      ...entry("pago", "EXPENSE", "NEEDS", "15.00", "2026-01-30"),
      period: "2026-02",
      fixed_expense_id: "internet",
    },
    {
      ...entry("void", "EXPENSE", "NEEDS", "40.00", "2026-02-03", "void"),
      fixed_expense_id: "internet",
    },
  ];
  const b = expensesFor(d, "2026-02", "all");
  assert.equal(b.spent, 0);
  assert.equal(b.fixed[0].paid, 1500);
  assert.equal(b.fixedPending, 2500);
  assert.equal(b.fixed[0].dueDate, "2026-02-28");
  assert.equal(expensesFor(d, "2026-02", "1").fixed.length, 0);
  assert.equal(expensesFor(d, "2026-03", "all").fixed.length, 0);
  assert.equal(loanBudgetFor(d, "2026-02", "all").fixedPending, 0);
});
