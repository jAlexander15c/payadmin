import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { database } from "../../src/lib/db";
import { passwordHash } from "../../src/lib/auth";
import {
  confirmPayroll,
  receiveChunky,
  voidPayrollRecord,
} from "../../src/lib/payroll-store";
import { snapshot, createRecord, correctRecord } from "../../src/lib/store";
import { expensesFor } from "../../src/lib/expenses";
const user = randomUUID(),
  clock = "2026-10-31";
const body = () => ({
  requestKey: randomUUID(),
  date: "2026-10-14",
  period: "2026-10",
  half: "1",
  received: "496.66",
  deduction: "158.80",
  nextDue: "2026-11-16",
  allocation: { NEEDS: "248.33", WANTS: "149.00", SAVINGS: "99.33" },
});
const reason = { reason: "Corrección de registro de prueba" };
before(async () => {
  if (
    !process.env.DATABASE_URL ||
    !new URL(process.env.DATABASE_URL).pathname.endsWith("_test")
  )
    throw new Error("Usa exclusivamente una BD _test.");
  assert.equal(
    Number(
      (await database().query("SELECT count(*) AS n FROM payroll_cycles"))
        .rows[0].n,
    ),
    0,
  );
  await database().query(
    "INSERT INTO app_users(id,email,password_hash) VALUES($1,$2,$3)",
    [
      user,
      `payroll-${user}@payadmin.invalid`,
      await passwordHash(randomUUID()),
    ],
  );
});
after(async () => {
  const db = database();
  await db.query("DELETE FROM audit_log WHERE user_id=$1", [user]);
  await db.query(
    "DELETE FROM cash_entries WHERE created_by=$1 AND ledger='EXPENSES'",
    [user],
  );
  await db.query("DELETE FROM payroll_receipts WHERE created_by=$1", [user]);
  await db.query("DELETE FROM payroll_cycles WHERE created_by=$1", [user]);
  await db.query("DELETE FROM cash_entries WHERE created_by=$1", [user]);
  await db.query(
    "DELETE FROM contribution_links WHERE movement_id IN (SELECT id FROM bank_movements WHERE created_by=$1)",
    [user],
  );
  await db.query("DELETE FROM contributions WHERE created_by=$1", [user]);
  await db.query(
    "DELETE FROM compensations WHERE movement_id IN (SELECT id FROM bank_movements WHERE created_by=$1)",
    [user],
  );
  await db.query("DELETE FROM bank_movements WHERE created_by=$1", [user]);
  await db.query("DELETE FROM app_users WHERE id=$1", [user]);
  await snapshot(clock);
  await db.end();
});
test("Quincena atómica: salario neto, deducción independiente y cobro posterior", async (t) => {
  let cycleId = "",
    receiptId = "";
  const original = body();
  await t.test(
    "Los reintentos concurrentes no duplican salario, reparto ni deducción",
    async () => {
      const results = await Promise.all(
        Array.from({ length: 4 }, () => confirmPayroll(original, user, clock)),
      );
      cycleId = results[0].id;
      assert.ok(results.every((r) => r.id === cycleId));
      assert.equal(results.filter((r) => !r.duplicate).length, 1);
      const d = await snapshot(clock);
      assert.equal(d.real.paid, 15880);
      assert.equal(d.cash.filter((r) => r.status === "active").length, 1);
      assert.equal(
        d.expenseCash.filter((r) => r.status === "active").length,
        3,
      );
      assert.deepEqual(
        d.funds.map((r) => r.balance),
        [24833, 14900, 9933],
      );
      assert.equal(d.contributions.length, 0);
      assert.equal(d.rawMovements.filter((r) => r.type === "CREDI").length, 0);
      assert.equal(d.payrollCycles[0].chunky_expected, "85.62");
      assert.equal(d.current.schedule[0].date, "2026-11-16");
      assert.equal(expensesFor(d, "2026-10", "all").income, 49666);
    },
  );
  await t.test(
    "Duplicados, reparto incorrecto y fechas futuras no dejan filas parciales",
    async () => {
      await assert.rejects(
        () => confirmPayroll(body(), user, clock),
        /ya está registrada/,
      );
      await assert.rejects(
        () =>
          confirmPayroll(
            {
              ...original,
              received: "500.00",
              allocation: { NEEDS: "250", WANTS: "150", SAVINGS: "100" },
            },
            user,
            clock,
          ),
        /datos distintos/,
      );
      await assert.rejects(
        () =>
          confirmPayroll(
            {
              ...body(),
              allocation: { NEEDS: "200", WANTS: "149", SAVINGS: "99.33" },
            },
            user,
            clock,
          ),
        /exactamente/,
      );
      await assert.rejects(
        () =>
          confirmPayroll(
            { ...body(), date: "2026-11-01", period: "2026-11" },
            user,
            clock,
          ),
        /ya recibiste/,
      );
      const d = await snapshot(clock);
      assert.equal(d.payrollCycles.length, 1);
      assert.equal(d.real.paid, 15880);
    },
  );
  await t.test(
    "No se permite corregir piezas de la quincena por separado ni repetir la deducción manualmente",
    async () => {
      const d = await snapshot(clock),
        cycle = d.payrollCycles[0];
      for (const [kind, id] of [
        ["bank", cycle.bank_movement_id],
        ["cash", cycle.budget_cash_id],
        ["expense", d.expenseCash[0].id],
      ] as const)
        await assert.rejects(
          () =>
            correctRecord(
              kind,
              id,
              { action: "void", revision: 1, reason: reason.reason },
              user,
              clock,
            ),
          /quincena/,
        );
      await assert.rejects(
        () =>
          createRecord(
            "bank",
            {
              requestKey: randomUUID(),
              date: "2026-10-14",
              period: "2026-10",
              type: "REGULAR",
              amount: "158.80",
              notes: "Duplicado",
              links: [],
            },
            user,
            clock,
          ),
        /ya tiene salario/,
      );
    },
  );
  await t.test(
    "Cobro posterior parcial a ahorro; reintentos y sobrecobros no duplican banco ni entradas",
    async () => {
      const receipt = {
        requestKey: randomUUID(),
        payrollId: cycleId,
        date: "2026-10-20",
        amount: "40.00",
        allocation: { NEEDS: "0", WANTS: "0", SAVINGS: "40" },
      };
      const rows = await Promise.all([
        receiveChunky(receipt, user, clock),
        receiveChunky(receipt, user, clock),
      ]);
      receiptId = rows[0].id;
      assert.equal(rows[1].id, receiptId);
      const d = await snapshot(clock);
      assert.equal(d.real.paid, 15880);
      assert.equal(d.links.length, 0);
      assert.equal(d.contributions.length, 1);
      assert.equal(d.contributions[0].payroll_receipt_id, receiptId);
      assert.deepEqual(
        d.funds.map((r) => r.balance),
        [24833, 14900, 13933],
      );
      assert.equal(expensesFor(d, "2026-10", "all").income, 53666);
      await assert.rejects(
        () =>
          receiveChunky(
            {
              ...receipt,
              requestKey: randomUUID(),
              amount: "50",
              allocation: { NEEDS: "50", WANTS: "0", SAVINGS: "0" },
            },
            user,
            clock,
          ),
        /supera lo pendiente/,
      );
      await assert.rejects(
        () =>
          receiveChunky(
            { ...receipt, requestKey: randomUUID(), date: "2026-10-13" },
            user,
            clock,
          ),
        /posterior/,
      );
      await assert.rejects(
        () => voidPayrollRecord("payroll", cycleId, reason, user, clock),
        /primero los cobros/,
      );
      await assert.rejects(
        () =>
          correctRecord(
            "contribution",
            d.contributions[0].id,
            { action: "void", revision: 1, reason: reason.reason },
            user,
            clock,
          ),
        /quincena/,
      );
      await assert.rejects(
        () =>
          createRecord(
            "bank",
            {
              requestKey: randomUUID(),
              date: clock,
              period: "2026-10",
              type: "EXTRA_CHUNKY",
              amount: "40",
              notes: "Reutilización indebida",
              links: [{ id: d.contributions[0].id, amount: "40" }],
            },
            user,
            clock,
          ),
        /repartido|distribuy/,
      );
    },
  );
  await t.test(
    "La segunda quincena registra otra deducción; cancelar un cobro conserva el banco",
    async () => {
      await confirmPayroll(
        { ...body(), date: "2026-10-30", half: "2" },
        user,
        clock,
      );
      let d = await snapshot(clock);
      assert.equal(d.real.paid, 31760);
      assert.equal(
        d.payrollCycles.filter((r) => r.status === "active").length,
        2,
      );
      assert.equal(d.real.periods.length, 1);
      assert.ok(d.real.bags.cards.capital < 800308);
      await voidPayrollRecord(
        "payroll_receipt",
        receiptId,
        reason,
        user,
        clock,
      );
      d = await snapshot(clock);
      assert.equal(d.real.paid, 31760);
      assert.deepEqual(
        d.funds.map((r) => r.balance),
        [49666, 29800, 19866],
      );
      await voidPayrollRecord("payroll", cycleId, reason, user, clock);
      d = await snapshot(clock);
      assert.equal(d.real.paid, 15880);
      assert.deepEqual(
        d.funds.map((r) => r.balance),
        [24833, 14900, 9933],
      );
      await voidPayrollRecord(
        "payroll",
        d.payrollCycles.find((r) => r.status === "active")!.id,
        reason,
        user,
        clock,
      );
    },
  );
  await t.test(
    "Una deducción y planilla manuales idénticas se reutilizan y sobreviven a anular y reconfirmar",
    async () => {
      const bank = await createRecord(
        "bank",
        {
          requestKey: randomUUID(),
          date: "2026-10-14",
          period: "2026-10",
          type: "REGULAR",
          amount: "158.80",
          links: [],
        },
        user,
        clock,
      );
      const cash = await createRecord(
        "cash",
        {
          requestKey: randomUUID(),
          date: "2026-10-14",
          period: "2026-10",
          kind: "PAYROLL",
          category: "OTHER",
          amount: "496.66",
          concept: "Ingreso manual anterior",
        },
        user,
        clock,
      );
      let r = await confirmPayroll(body(), user, clock),
        d = await snapshot(clock),
        cycle = d.payrollCycles.find((x) => x.id === r.id)!;
      assert.equal(cycle.bank_movement_id, bank.id);
      assert.equal(cycle.budget_cash_id, cash.id);
      assert.equal(cycle.owns_bank, false);
      assert.equal(cycle.owns_cash, false);
      assert.equal(d.real.paid, 15880);
      await voidPayrollRecord("payroll", r.id, reason, user, clock);
      d = await snapshot(clock);
      assert.equal(d.real.paid, 15880);
      assert.deepEqual(
        d.funds.map((r) => r.balance),
        [0, 0, 0],
      );
      await assert.rejects(
        () => confirmPayroll({ ...body(), deduction: "150.00" }, user, clock),
        /manual distinta/,
      );
      r = await confirmPayroll(body(), user, clock);
      assert.equal((await snapshot(clock)).real.paid, 15880);
      await voidPayrollRecord("payroll", r.id, reason, user, clock);
    },
  );
  await t.test(
    "Una quincena sin deducción no inventa deuda ni cobros pendientes",
    async () => {
      const r = await confirmPayroll(
          { ...body(), date: "2026-10-30", half: "2", deduction: "0" },
          user,
          clock,
        ),
        d = await snapshot(clock),
        cycle = d.payrollCycles.find((x) => x.id === r.id)!;
      assert.equal(cycle.bank_movement_id, null);
      assert.equal(cycle.chunky_expected, "0.00");
      assert.equal(d.real.paid, 15880);
      await voidPayrollRecord("payroll", r.id, reason, user, clock);
    },
  );
  await t.test(
    "Dos quincenas pagadas en la segunda mitad del mes mantienen sus registros propios",
    async () => {
      const input = {
        ...body(),
        period: "2026-11",
        date: "2026-11-16",
        nextDue: "2026-12-16",
      };
      const first = await confirmPayroll(input, user, "2026-11-30");
      const second = await confirmPayroll(
        { ...input, requestKey: randomUUID(), half: "2", date: "2026-11-30" },
        user,
        "2026-11-30",
      );
      const cycles = (await snapshot("2026-11-30")).payrollCycles.filter(
        (r) => r.status === "active",
      );
      assert.equal(cycles.length, 2);
      assert.notEqual(cycles[0].bank_movement_id, cycles[1].bank_movement_id);
      for (const id of [first.id, second.id])
        await voidPayrollRecord("payroll", id, reason, user, "2026-11-30");
    },
  );
});
