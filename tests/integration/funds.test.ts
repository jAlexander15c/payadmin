import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { database } from "../../src/lib/db";
import { passwordHash } from "../../src/lib/auth";
import {
  adjustFund,
  createRecord,
  correctRecord,
  snapshot,
} from "../../src/lib/store";
import { budgetFor } from "../../src/lib/budget";
const user = randomUUID(),
  clock = "2026-10-20";
const input = (
  bucket = "NEEDS",
  operation = "SET",
  amount = "100.00",
  expectedBalance = 0,
) => ({
  requestKey: randomUUID(),
  bucket,
  operation,
  amount,
  expectedBalance,
  reason: "Ajuste de prueba de saldos",
});
before(async () => {
  if (
    !process.env.DATABASE_URL ||
    !new URL(process.env.DATABASE_URL).pathname.endsWith("_test")
  )
    throw new Error("Usa exclusivamente una BD _test.");
  await database().query(
    "INSERT INTO app_users(id,email,password_hash) VALUES($1,$2,$3)",
    [user, `funds-${user}@payadmin.invalid`, await passwordHash(randomUUID())],
  );
});
after(async () => {
  await database().query("DELETE FROM audit_log WHERE user_id=$1", [user]);
  await database().query("DELETE FROM fund_adjustments WHERE created_by=$1", [
    user,
  ]);
  await database().query("DELETE FROM cash_entries WHERE created_by=$1", [
    user,
  ]);
  await database().query("DELETE FROM app_users WHERE id=$1", [user]);
  await database().end();
});
test("Totales PostgreSQL: idempotencia, gastos, saldo cero y edición concurrente", async (t) => {
  await t.test(
    "Poner el total y reintentar no crea cinco ingresos ni cinco ajustes",
    async () => {
      const body = input();
      const rows = await Promise.all(
        Array.from({ length: 5 }, () => adjustFund(body, user, clock)),
      );
      assert.ok(rows.every((r) => r.id === rows[0].id));
      assert.equal(rows.filter((r) => !r.duplicate).length, 1);
      // Before this feature, persisted requests did not contain an effect.
      await database().query(
        "UPDATE audit_log SET after_data=after_data-'effect' WHERE entity='fund' AND entity_id=$1",
        [rows[0].id],
      );
      assert.equal((await adjustFund(body, user, clock)).duplicate, true);
      const d = await snapshot(clock);
      assert.equal(d.funds[0].balance, 10000);
      assert.equal(d.cash.length, 0);
      assert.equal(d.initialBudget.income, 0);
      assert.equal(d.real.paid, 0);
      await assert.rejects(
        () => adjustFund({ ...body, amount: "200.00" }, user, clock),
        /datos distintos/,
      );
    },
  );
  await t.test(
    "Agregar y sacar actualiza el saldo y consume presupuesto una vez",
    async () => {
      await adjustFund(input("NEEDS", "ADD", "20.00", 10000), user, clock);
      await adjustFund(input("NEEDS", "REMOVE", "15.00", 12000), user, clock);
      const d = await snapshot(clock),
        b = budgetFor(d, "2026-10", "all");
      assert.equal(d.funds[0].balance, 10500);
      assert.equal(b.income, 0);
      assert.equal(b.spent, 1500);
      assert.equal(b.actualCash, -1500);
      assert.equal(b.categories[0].used, 1500);
    },
  );
  await t.test(
    "Un gasto existente descuenta fondos y su anulación los devuelve",
    async () => {
      const r = await createRecord(
        "cash",
        {
          requestKey: randomUUID(),
          date: clock,
          period: "2026-10",
          kind: "EXPENSE",
          category: "NEEDS",
          amount: "5.00",
          concept: "Gasto de prueba",
        },
        user,
        clock,
      );
      assert.equal((await snapshot(clock)).funds[0].balance, 10000);
      await correctRecord(
        "cash",
        r.id,
        { revision: 1, action: "void", reason: "Anular gasto de prueba" },
        user,
        clock,
      );
      assert.equal((await snapshot(clock)).funds[0].balance, 10500);
    },
  );
  await t.test(
    "Saldo cero válido y SET obsoleto rechazado; ADD/REMOVE concurrentes no se pierden",
    async () => {
      await adjustFund(input("NEEDS", "SET", "0", 10500), user, clock);
      assert.equal((await snapshot(clock)).funds[0].balance, 0);
      await assert.rejects(
        () => adjustFund(input("NEEDS", "SET", "50.00", 10500), user, clock),
        /saldo cambió/,
      );
      await Promise.all([
        adjustFund(input("NEEDS", "ADD", "10.01", 0), user, clock),
        adjustFund(input("NEEDS", "ADD", "20.02", 0), user, clock),
      ]);
      assert.equal((await snapshot(clock)).funds[0].balance, 3003);
      await assert.rejects(
        () => adjustFund(input("NEEDS", "REMOVE", "0", 3003), user, clock),
        /mayor que cero/,
      );
    },
  );
  await t.test(
    "Ahorro conserva depósitos existentes, edición y retiro sin duplicar caja",
    async () => {
      await createRecord(
        "cash",
        {
          requestKey: randomUUID(),
          date: clock,
          period: "2026-10",
          kind: "SAVINGS_OPENING",
          category: "SAVINGS",
          amount: "100.00",
          concept: "Ahorro previo",
        },
        user,
        clock,
      );
      await adjustFund(input("SAVINGS", "SET", "200.00", 10000), user, clock);
      await adjustFund(input("SAVINGS", "ADD", "10.00", 20000), user, clock);
      await adjustFund(input("SAVINGS", "REMOVE", "30.00", 21000), user, clock);
      const d = await snapshot(clock),
        b = budgetFor(d, "2026-10", "all");
      assert.equal(d.funds[2].balance, 18000);
      assert.equal(b.savingsBalance, 18000);
      assert.equal(b.savingsSpent, 3000);
      assert.equal(b.actualCash, -1500);
      assert.equal(b.categories[2].used, 0);
      assert.ok(
        d.fundAdjustments.every(
          (r) =>
            Number(r.after_balance) ===
            Number(r.before_balance) + Number(r.delta),
        ),
      );
      assert.equal(
        (
          await database().query(
            "SELECT count(*)::int AS n FROM audit_log WHERE user_id=$1 AND entity='fund'",
            [user],
          )
        ).rows[0].n,
        d.fundAdjustments.length,
      );
    },
  );
  await t.test(
    "Ingreso extra y ajuste por gastos anteriores se distinguen sin obligar a reconstruirlos",
    async () => {
      const baseline = budgetFor(await snapshot(clock), "2026-10", "all");
      const raw = {
        ...input("WANTS", "ADD", "50.00", 0),
        effect: "INCOME",
        reason: "",
      };
      const rows = await Promise.all([
        adjustFund(raw, user, clock),
        adjustFund(raw, user, clock),
      ]);
      assert.equal(rows[0].id, rows[1].id);
      await adjustFund(
        {
          ...input("WANTS", "REMOVE", "20.00", 5000),
          effect: "ADJUSTMENT",
          reason: "",
        },
        user,
        clock,
      );
      const d = await snapshot(clock),
        b = budgetFor(d, "2026-10", "all");
      assert.equal(d.funds[1].balance, 3000);
      assert.equal(b.income, baseline.income + 5000);
      assert.equal(b.spent, baseline.spent);
      assert.equal(b.actualCash, baseline.actualCash + 5000);
      assert.equal(b.categories[1].extraIncome, 5000);
      assert.equal(b.categories[1].used, 0);
      assert.ok(
        d.fundAdjustments
          .filter((r) => r.bucket === "WANTS")
          .every((r) => r.reason.length > 0),
      );
      await adjustFund(
        { ...input("SAVINGS", "ADD", "10.00", 18000), effect: "INCOME" },
        user,
        clock,
      );
      await adjustFund(
        { ...input("SAVINGS", "REMOVE", "5.00", 19000), effect: "ADJUSTMENT" },
        user,
        clock,
      );
      const next = budgetFor(await snapshot(clock), "2026-10", "all");
      assert.equal(next.savingsBalance, 18500);
      assert.equal(next.actualCash, b.actualCash);
      assert.equal(next.spent, b.spent);
      assert.equal(next.savingsSpent, b.savingsSpent);
      assert.equal(next.extraIncomeSaved, 1000);
      await assert.rejects(
        () =>
          adjustFund(
            { ...input("WANTS", "REMOVE", "1.00", 3000), effect: "INCOME" },
            user,
            clock,
          ),
        /no corresponde/,
      );
    },
  );
});
