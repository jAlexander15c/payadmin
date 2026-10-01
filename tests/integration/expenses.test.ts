import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { database } from "../../src/lib/db";
import { passwordHash } from "../../src/lib/auth";
import {
  saveFixedExpense,
  createRecord,
  correctRecord,
  snapshot,
} from "../../src/lib/store";
import { expensesFor } from "../../src/lib/expenses";
import { loanBudgetFor } from "../../src/lib/budget";
const user = randomUUID(),
  clock = "2026-10-30";
let fixedId = "";
const config = () => ({
  requestKey: randomUUID(),
  effectivePeriod: "2026-10",
  name: "Internet prueba",
  amount: "40.00",
  dueDay: 10,
  active: true,
});
const cash = (amount = "10.00") => ({
  requestKey: randomUUID(),
  date: "2026-10-02",
  period: "2026-10",
  kind: "EXPENSE",
  category: "NEEDS",
  amount,
  concept: "Pago de internet prueba",
  fixedExpenseId: fixedId,
});
before(async () => {
  if (
    !process.env.DATABASE_URL ||
    !new URL(process.env.DATABASE_URL).pathname.endsWith("_test")
  )
    throw new Error("Usa exclusivamente una BD _test aislada.");
  await database().query(
    "INSERT INTO app_users(id,email,password_hash) VALUES($1,$2,$3)",
    [
      user,
      `expenses-${user}@payadmin.invalid`,
      await passwordHash(randomUUID()),
    ],
  );
});
after(async () => {
  await database().query("DELETE FROM audit_log WHERE user_id=$1", [user]);
  await database().query("DELETE FROM cash_entries WHERE created_by=$1", [
    user,
  ]);
  await database().query(
    "DELETE FROM fixed_expense_versions WHERE created_by=$1",
    [user],
  );
  if (fixedId)
    await database().query("DELETE FROM fixed_expenses WHERE id=$1", [fixedId]);
  await database().query("DELETE FROM app_users WHERE id=$1", [user]);
  await database().end();
});
test("Gastos PostgreSQL: pagos parciales, reintentos, correcciones, vigencias y ahorro", async (t) => {
  await t.test(
    "Configurar un fijo aparece en el control de gastos sin alterar el presupuesto del préstamo",
    async () => {
      const raw = config();
      const all = await Promise.all(
        Array.from({ length: 5 }, () => saveFixedExpense(raw, user)),
      );
      fixedId = all[0].id;
      assert.ok(all.every((r) => r.id === fixedId));
      assert.equal(all.filter((r) => !r.duplicate).length, 1);
      const d = await snapshot(clock);
      assert.equal(d.expenseCash.length, 0);
      assert.equal(expensesFor(d, "2026-10", "all").fixedPending, 4000);
      assert.equal(d.real.paid, 0);
      assert.equal(loanBudgetFor(d, "2026-10", "all").spent, 0);
      assert.equal(loanBudgetFor(d, "2026-10", "all").fixedPending, 0);
      await assert.rejects(
        () => saveFixedExpense({ ...raw, amount: "50.00" }, user),
        /datos distintos/,
      );
    },
  );
  let payment = "";
  await t.test(
    "Pago parcial idempotente usa un solo registro de caja",
    async () => {
      const raw = cash();
      const rows = await Promise.all(
        Array.from({ length: 5 }, () =>
          createRecord("expense", raw, user, clock),
        ),
      );
      payment = rows[0].id;
      assert.ok(rows.every((r) => r.id === payment));
      assert.equal(rows.filter((r) => !r.duplicate).length, 1);
      const d = await snapshot(clock),
        b = expensesFor(d, "2026-10", "all");
      assert.equal(b.fixed[0].paid, 1000);
      assert.equal(b.fixedPending, 3000);
      assert.equal(b.spent, 1000);
      assert.equal(d.real.paid, 0);
      assert.equal(loanBudgetFor(d, "2026-10", "all").spent, 0);
      assert.equal(loanBudgetFor(d, "2026-10", "all").fixedPending, 0);
    },
  );
  await t.test(
    "Corregir y anular restaura caja, reserva y auditoría",
    async () => {
      const d = await snapshot(clock),
        r = d.expenseCash.find((r) => r.id === payment)!;
      await correctRecord(
        "expense",
        payment,
        {
          revision: r.revision,
          action: "correct",
          reason: "Importe revisado para prueba",
          data: { ...cash("20.00"), requestKey: r.request_key },
        },
        user,
        clock,
      );
      let b = expensesFor(await snapshot(clock), "2026-10", "all");
      assert.equal(b.spent, 2000);
      assert.equal(b.fixedPending, 2000);
      await correctRecord(
        "expense",
        payment,
        { revision: 2, action: "void", reason: "Pago de prueba anulado" },
        user,
        clock,
      );
      b = expensesFor(await snapshot(clock), "2026-10", "all");
      assert.equal(b.spent, 0);
      assert.equal(b.fixedPending, 4000);
      assert.equal(
        (
          await database().query(
            "SELECT count(*)::int AS n FROM audit_log WHERE entity='expense' AND entity_id=$1",
            [payment],
          )
        ).rows[0].n,
        3,
      );
    },
  );
  await t.test(
    "Ahorro separado y gastos desde ahorro no duplican salida de caja",
    async () => {
      await createRecord(
        "expense",
        {
          ...cash("100.00"),
          kind: "SAVINGS_OPENING",
          category: "SAVINGS",
          fixedExpenseId: null,
          concept: "Saldo previo",
        },
        user,
        clock,
      );
      await createRecord(
        "expense",
        {
          ...cash("20.00"),
          kind: "SAVING",
          category: "SAVINGS",
          fixedExpenseId: null,
          concept: "Apartado de ahorro",
        },
        user,
        clock,
      );
      await createRecord(
        "expense",
        {
          ...cash("30.00"),
          funding: "SAVINGS",
          category: "WANTS",
          fixedExpenseId: null,
          concept: "Compra desde ahorro",
        },
        user,
        clock,
      );
      const b = expensesFor(await snapshot(clock), "2026-10", "all");
      assert.equal(b.net, -3000);
      assert.equal((await snapshot(clock)).funds[2].balance, 9000);
      assert.equal(b.categories[1].spent, 0);
      assert.equal(b.categories[2].spent, 3000);
      await assert.rejects(
        () =>
          createRecord(
            "expense",
            {
              ...cash(),
              funding: "SAVINGS",
              kind: "INCOME",
              fixedExpenseId: null,
            },
            user,
            clock,
          ),
        /Solo un gasto/,
      );
      await assert.rejects(
        () =>
          createRecord(
            "expense",
            { ...cash(), date: "2026-10-31" },
            user,
            clock,
          ),
        /fecha futura/,
      );
      await assert.rejects(
        () =>
          createRecord(
            "expense",
            { ...cash(), fixedExpenseId: randomUUID() },
            user,
            clock,
          ),
        /no está activo/,
      );
    },
  );
  await t.test(
    "Editar con vigencia futura conserva meses anteriores y detecta ediciones concurrentes",
    async () => {
      const item = (await snapshot(clock)).fixedExpenses.find(
        (v) => v.fixed_id === fixedId,
      )!;
      await saveFixedExpense(
        {
          ...config(),
          id: fixedId,
          revision: item.revision,
          effectivePeriod: "2026-11",
          amount: "50.00",
        },
        user,
      );
      const d = await snapshot(clock);
      assert.equal(expensesFor(d, "2026-10", "all").fixedPending, 4000);
      assert.equal(expensesFor(d, "2026-11", "all").fixedPending, 5000);
      await assert.rejects(
        () =>
          saveFixedExpense(
            { ...config(), id: fixedId, revision: item.revision },
            user,
          ),
        /cambió/,
      );
      await saveFixedExpense(
        {
          ...config(),
          id: fixedId,
          revision: 2,
          effectivePeriod: "2026-12",
          active: false,
        },
        user,
      );
      assert.equal(
        expensesFor(await snapshot(clock), "2026-12", "all").fixed.length,
        0,
      );
      await assert.rejects(
        () =>
          createRecord(
            "expense",
            { ...cash(), period: "2026-09" },
            user,
            clock,
          ),
        /no está activo/,
      );
    },
  );
});
