import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { database } from "../../src/lib/db";
import { passwordHash, verifyPassword, HttpError } from "../../src/lib/auth";
import {
  createRecord,
  correctRecord,
  snapshot,
  saveStatement,
  saveParameters,
  saveResponsibilities,
  confirmFirstDate,
  createCashCompensation,
  correctCashCompensation,
} from "../../src/lib/store";
import { money, SOURCES } from "../../src/lib/finance";
const clock = "2026-10-30",
  user = randomUUID();
function bank(type = "REGULAR", amount = "317.60", key = randomUUID()) {
  return {
    requestKey: key,
    date: "2026-10-15",
    period: "2026-10",
    type,
    amount,
    notes: "Prueba en BD aislada",
    links: [],
  };
}
before(async () => {
  if (
    !process.env.DATABASE_URL ||
    !new URL(process.env.DATABASE_URL).pathname.endsWith("_test")
  )
    throw new Error(
      "Usa exclusivamente una DATABASE_URL cuya base termine en _test.",
    );
  await database().query(
    "TRUNCATE bank_movements,statements,contributions,cash_entries,allocations,compensations,period_results,audit_log,responsibility_versions,loan_schedule_versions,login_attempts CASCADE",
  );
  await database().query(
    "INSERT INTO parameter_versions(id,effective_period,annual_interest,annual_feci,regular_payment,chunky_payment,credi_payment,first_due,salary) VALUES('00000000-0000-4000-8000-000000000001','2026-10',0.095,0.01,317.60,171.24,62.56,'2026-10-15',1310.92) ON CONFLICT DO NOTHING",
  );
  await database().query(
    "INSERT INTO app_users(id,email,password_hash) VALUES($1,$2,$3)",
    [
      user,
      "integration@payadmin.invalid",
      await passwordHash("A-long-test-only-password"),
    ],
  );
});
after(async () => {
  await database().query(
    "TRUNCATE bank_movements,statements,contributions,cash_entries,allocations,compensations,period_results,audit_log,responsibility_versions,loan_schedule_versions,login_attempts CASCADE",
  );
  await database().query("DELETE FROM app_users WHERE id=$1", [user]);
  await database().end();
});
test("Persistencia PostgreSQL, idempotencia, auditoría y recálculo", async (t) => {
  let receipt = "",
    regular = "",
    quota = "";
  await t.test(
    "Los datos iniciales y NUMERIC provienen de PostgreSQL",
    async () => {
      const d = await snapshot("2026-09-30");
      assert.equal(d.totals.capital, 1815000);
      assert.equal(d.real.paid, 0);
      assert.equal(d.history.length, 11);
      assert.equal(d.composition.length, 12);
      const r = await database().query(
        "SELECT data_type FROM information_schema.columns WHERE table_name='bank_movements' AND column_name='amount'",
      );
      assert.equal(r.rows[0].data_type, "numeric");
    },
  );
  await t.test(
    "Un aporte recibido no aplicado no paga ni amortiza BG",
    async () => {
      receipt = (
        await createRecord(
          "contribution",
          {
            requestKey: randomUUID(),
            date: "2026-10-02",
            period: "2026-10",
            source: "chunky",
            contributor: "Chunky Bites",
            amount: "171.24",
            notes: "",
          },
          user,
          clock,
        )
      ).id;
      const d = await snapshot("2026-10-15");
      assert.equal(d.real.paid, 0);
      assert.equal(d.totals.received, 17124);
      assert.equal(d.totals.linked, 0);
      assert.equal(d.totals.capital, 1815000);
    },
  );
  await t.test(
    "Reintentos simultáneos crean un solo pago y conservan vínculos",
    async () => {
      const body = { ...bank(), links: [{ id: receipt, amount: "171.24" }] };
      const r = await Promise.all(
        Array.from({ length: 8 }, () =>
          createRecord("bank", body, user, clock),
        ),
      );
      regular = r[0].id;
      assert.ok(r.every((x) => x.id === regular));
      assert.equal(r.filter((x) => !x.duplicate).length, 1);
      const d = await snapshot("2026-10-15");
      assert.equal(d.real.paid, 31760);
      assert.equal(d.totals.linked, 17124);
      assert.equal(d.real.advance, 1180);
      await assert.rejects(
        () => createRecord("bank", { ...body, amount: "317.61" }, user, clock),
        (e) => e instanceof HttpError && e.status === 409,
      );
    },
  );
  await t.test(
    "Cuota CrediJamar persiste capital y compensación, sin doble interés",
    async () => {
      quota = (await createRecord("bank", bank("CREDI", "62.56"), user, clock))
        .id;
      const r = await database().query(
        "SELECT reimbursed FROM compensations WHERE movement_id=$1",
        [quota],
      );
      assert.equal(r.rows[0].reimbursed, "11.80");
      const a = await database().query(
        "SELECT principal FROM allocations WHERE movement_id=$1 AND source_id='credi'",
        [quota],
      );
      assert.equal(a.rows[0].principal, "50.76");
      const d = await snapshot("2026-10-15");
      assert.equal(d.real.paid, 38016);
      assert.equal(d.real.advance, 0);
    },
  );
  await t.test(
    "No se puede duplicar ni anular un aporte ya aplicado",
    async () => {
      await assert.rejects(
        () =>
          createRecord(
            "bank",
            {
              ...bank("EXTRA_CHUNKY", "200.00"),
              links: [{ id: receipt, amount: "171.24" }],
            },
            user,
            clock,
          ),
        (e) => e instanceof HttpError && e.status === 409,
      );
      await assert.rejects(
        () =>
          correctRecord(
            "contribution",
            receipt,
            { revision: 1, action: "void", reason: "Revisión de aporte" },
            user,
            clock,
          ),
        (e) => e instanceof HttpError && e.status === 409,
      );
    },
  );
  await t.test(
    "Corrección anterior recalcula asignaciones posteriores y registra antes/después",
    async () => {
      const body = {
        ...bank("REGULAR", "158.80"),
        links: [{ id: receipt, amount: "85.62" }],
      };
      await correctRecord(
        "bank",
        regular,
        {
          revision: 1,
          action: "correct",
          reason: "Primer descuento real parcial",
          data: body,
        },
        user,
        clock,
      );
      const d = await snapshot("2026-10-15");
      assert.equal(d.real.paid, 22136);
      assert.equal(d.totals.linked, 8562);
      assert.ok(d.totals.pending > 0);
      assert.ok(
        d.audit.some(
          (x) =>
            x.action === "correct" &&
            x.before_data.amount === "317.60" &&
            x.after_data.amount === "158.80",
        ),
      );
      await assert.rejects(
        () =>
          correctRecord(
            "bank",
            regular,
            { revision: 1, action: "void", reason: "Versión anterior" },
            user,
            clock,
          ),
        (e) => e instanceof HttpError && e.status === 409,
      );
    },
  );
  await t.test(
    "Extracto cero confirmado y saldo reportado distinto no ajustan capital",
    async () => {
      await saveStatement(
        {
          period: "2026-10",
          interest: "0",
          feci: "0",
          other: "",
          concept: "",
          principal: "0",
          balance: "18000",
          notes: "",
          reason: "Extracto confirmado de prueba",
        },
        user,
        clock,
      );
      const d = await snapshot("2026-10-15");
      assert.equal(d.real.periods[0].interest, 0);
      assert.equal(d.real.periods[0].feci, 0);
      assert.equal(d.real.periods[0].principalDifference, 22136);
      assert.notEqual(d.real.periods[0].balanceDifference, 0);
      assert.equal(d.real.advance, 0);
      const comp = await database().query(
        "SELECT reimbursed FROM compensations WHERE movement_id=$1",
        [quota],
      );
      assert.equal(comp.rows[0].reimbursed, "0.00");
    },
  );
  await t.test("Anular no borra, conserva auditoría y recalcula", async () => {
    await correctRecord(
      "bank",
      quota,
      {
        revision: 1,
        action: "void",
        reason: "Movimiento duplicado confirmado",
      },
      user,
      clock,
    );
    const d = await snapshot("2026-10-15");
    assert.equal(d.real.paid, 15880);
    assert.ok(
      d.rawMovements.some((x) => x.id === quota && x.status === "void"),
    );
    assert.equal(
      (
        await database().query(
          "SELECT 1 FROM allocations WHERE movement_id=$1",
          [quota],
        )
      ).rowCount,
      0,
    );
  });
  await t.test(
    "No se reescribe la historia por cambios de cuota o responsabilidad",
    async () => {
      const values = {
        effectivePeriod: "2026-10",
        interest: "0.1",
        feci: "0.01",
        regular: "317.60",
        chunky: "171.24",
        credi: "62.56",
        firstDue: "2026-10-15",
        provisional: false,
        salary: "1310.92",
        salaryIncludesLoan: false,
        reason: "Nueva tasa futura",
      };
      await assert.rejects(
        () => saveParameters(values, user, clock),
        (e) => e instanceof HttpError && e.status === 409,
      );
      await saveResponsibilities(
        {
          effectivePeriod: "2026-11",
          participants: [
            { name: "Javier", percent: "35" },
            { name: "Otra persona", percent: "65" },
          ],
          reason: "Acuerdo explícito de prueba",
        },
        user,
        clock,
      );
      const d = await snapshot("2026-10-15");
      assert.equal(d.participants[0].participants[0].percent, "35");
      assert.equal(d.real.paid, 15880);
    },
  );
  await t.test(
    "Confirmar el día provisional después de pagar conserva versiones y fechas reales",
    async () => {
      const before = await snapshot("2026-10-15");
      await confirmFirstDate(
        {
          date: "2026-10-09",
          reason: "Primer vencimiento confirmado por el banco",
        },
        user,
        clock,
      );
      const after = await snapshot("2026-10-15");
      assert.equal(after.versions[0].firstDue, "2026-10-09");
      assert.equal(after.versions[0].originalFirstDue, "2026-10-15");
      assert.equal(after.parameters.provisional, false);
      assert.equal(after.real.paid, before.real.paid);
      assert.deepEqual(
        after.movements.map((x) => x.date),
        before.movements.map((x) => x.date),
      );
      assert.ok(after.audit.some((x) => x.entity === "first_due"));
      await assert.rejects(
        () =>
          confirmFirstDate(
            { date: "2026-11-09", reason: "Otro mes no autorizado" },
            user,
            clock,
          ),
        (e) => e instanceof HttpError && e.status === 409,
      );
    },
  );
  await t.test(
    "Cancelar BG y reembolsar a Javier no crea otro pago ni otro ingreso",
    async () => {
      await database().query(
        "TRUNCATE bank_movements,statements,contributions,cash_entries,cash_compensations,allocations,compensations,period_results,audit_log CASCADE",
      );
      const reg = (await createRecord("bank", bank(), user, clock)).id;
      const targets = {
        chunky: "EXTRA_CHUNKY",
        credi: "EXTRA_CREDI",
        cards: "EXTRA_CARDS",
        costs: "EXTRA_COSTS",
      };
      for (const s of SOURCES) {
        const d = await snapshot(clock);
        await createRecord(
          "bank",
          bank(targets[s], money(d.real.bags[s].capital)),
          user,
          clock,
        );
      }
      const before = await snapshot(clock);
      assert.equal(before.totals.capital, 0);
      assert.equal(before.totals.pending, 0);
      assert.equal(before.real.advance, 1180);
      const r = (
        await createRecord(
          "contribution",
          {
            requestKey: randomUUID(),
            date: "2026-10-20",
            period: "2026-10",
            source: "credi",
            contributor: "CrediJamar",
            amount: "11.80",
            notes: "Reembolso real de cargos",
          },
          user,
          clock,
        )
      ).id;
      const body = {
        requestKey: randomUUID(),
        receiptId: r,
        amount: "11.80",
        reason: "Reembolso posterior a cancelación bancaria",
      };
      const a = await createCashCompensation(body, user, clock);
      assert.equal(
        (await createCashCompensation(body, user, clock)).duplicate,
        true,
      );
      await assert.rejects(
        () => createCashCompensation({ ...body, amount: "11.79" }, user, clock),
        (e) => e instanceof HttpError && e.status === 409,
      );
      const d = await snapshot(clock);
      assert.equal(d.real.advance, 0);
      assert.equal(d.real.paid, before.real.paid);
      assert.equal(d.real.principal, before.real.principal);
      assert.equal(d.totals.received, 1180);
      assert.equal(d.totals.linked, 1180);
      assert.equal(d.real.bags.credi.closedOn, "2026-10-20");
      assert.equal(d.current.closeDate, "2026-10-15");
      assert.equal(d.controls.find((x) => x.id === 9)?.status, "pass");
      await assert.rejects(
        () =>
          correctRecord(
            "contribution",
            r,
            { revision: 1, action: "void", reason: "Aporte aún aplicado" },
            user,
            clock,
          ),
        (e) => e instanceof HttpError && e.status === 409,
      );
      await assert.rejects(
        () =>
          correctRecord(
            "bank",
            reg,
            {
              revision: 1,
              action: "void",
              reason: "Reabrir préstamo con reembolso",
            },
            user,
            clock,
          ),
        (e) => e instanceof HttpError && e.status === 409,
      );
      await correctCashCompensation(
        a.id,
        {
          revision: 1,
          action: "correct",
          amount: "5.00",
          reason: "Solo una parte aplicada",
        },
        user,
        clock,
      );
      assert.equal((await snapshot(clock)).real.advance, 680);
      await assert.rejects(
        () =>
          correctCashCompensation(
            a.id,
            {
              revision: 1,
              action: "void",
              reason: "Versión anterior inválida",
            },
            user,
            clock,
          ),
        (e) => e instanceof HttpError && e.status === 409,
      );
      await correctCashCompensation(
        a.id,
        {
          revision: 2,
          action: "void",
          reason: "Anular aplicación conservando aporte",
        },
        user,
        clock,
      );
      const undone = await snapshot(clock);
      assert.equal(undone.real.advance, 1180);
      assert.equal(undone.totals.received, 1180);
      assert.equal(undone.totals.linked, 0);
      assert.equal(undone.cashCompensations[0].status, "void");
    },
  );
  await t.test(
    "Autenticación almacena hashes y el servidor rechaza acceso anónimo y CSRF",
    async () => {
      const h = await passwordHash("another-test-password");
      assert.equal(await verifyPassword("another-test-password", h), true);
      assert.equal(await verifyPassword("wrong", h), false);
      if (!process.env.TEST_BASE_URL)
        throw new Error(
          "Falta TEST_BASE_URL del servidor local para validar accesos.",
        );
      const base = process.env.TEST_BASE_URL;
      for (const path of [
        "/api/snapshot",
        "/api/export",
        "/api/export?kind=allocations",
      ])
        assert.equal((await fetch(base + path)).status, 401);
      const noAuth = await fetch(base + "/api/bank", {
        method: "POST",
        headers: { Origin: base, "Content-Type": "application/json" },
        body: JSON.stringify(bank()),
      });
      assert.equal(noAuth.status, 401);
      const csrf = await fetch(base + "/api/bank", {
        method: "POST",
        headers: {
          Origin: "https://other.invalid",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(bank()),
      });
      assert.equal(csrf.status, 403);
    },
  );
});
