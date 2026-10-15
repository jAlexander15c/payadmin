import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { database } from "../../src/lib/db";
import { materialize, readData } from "../../src/lib/store";
import { INITIAL, cents, money, replay, sum } from "../../src/lib/finance";

after(async () => {
  await database().end();
});
test("Reclasificar Chunky conserva pagos y caja, y recalcula sus aplicaciones dentro de la migración", async () => {
  if (
    !process.env.DATABASE_URL ||
    !new URL(process.env.DATABASE_URL).pathname.endsWith("_test")
  )
    throw new Error("Usa exclusivamente una BD _test.");
  const c = await database().connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock(481512)");
    // Rebuild the previous composition only inside a rolled-back test transaction.
    await c.query(
      "UPDATE sources SET initial_capital=7024.34 WHERE id='chunky'",
    );
    await c.query(
      "UPDATE sources SET initial_capital=1773.58 WHERE id='costs'",
    );
    await c.query("UPDATE composition SET amount=7024.34 WHERE id='chunky'");
    await c.query("DELETE FROM composition WHERE id='chunky_difference'");
    const user = randomUUID(),
      bank = randomUUID();
    await c.query(
      "INSERT INTO app_users(id,email,password_hash) VALUES($1,$2,'unused-test-hash')",
      [user, `${user}@payadmin.invalid`],
    );
    await c.query(
      "INSERT INTO bank_movements(id,request_key,occurred_on,period,type,amount,created_by) VALUES($1,$2,'2026-10-14','2026-10','REGULAR',158.80,$3)",
      [bank, randomUUID(), user],
    );
    await c.query(
      "INSERT INTO cash_entries(id,request_key,occurred_on,period,kind,category,amount,concept,created_by,ledger) VALUES($1,$2,'2026-10-14','2026-10','PAYROLL','OTHER',496.66,'Planilla existente',$3,'BUDGET')",
      [randomUUID(), randomUUID(), user],
    );
    await c.query(
      "INSERT INTO cash_entries(id,request_key,occurred_on,period,kind,category,amount,concept,created_by,ledger) VALUES($1,$2,'2026-10-14','2026-10','INCOME','NEEDS',248.33,'Reparto existente',$3,'EXPENSES')",
      [randomUUID(), randomUUID(), user],
    );
    const beforeBank = (
      await c.query("SELECT * FROM bank_movements WHERE id=$1", [bank])
    ).rows;
    const beforeCash = (
      await c.query(
        "SELECT * FROM cash_entries WHERE created_by=$1 ORDER BY id",
        [user],
      )
    ).rows;
    const beforeAudit = Number(
      (
        await c.query(
          "SELECT count(*) AS n FROM audit_log WHERE entity='composition' AND entity_id='chunky'",
        )
      ).rows[0].n,
    );
    await c.query(
      await readFile("migrations/009_chunky_reclassification.sql", "utf8"),
    );
    await materialize(c, "2026-10-14");
    const d = await readData(c),
      real = replay(d.movements, d.statements, d.versions, "2026-10-14");
    for (const source of d.sources)
      assert.equal(
        cents(source.initial_capital),
        INITIAL[source.id as keyof typeof INITIAL],
      );
    assert.equal(sum(d.composition.map((r) => cents(r.amount))), 1815000);
    assert.equal(
      sum(
        d.composition
          .filter((r) => r.source_id === "costs")
          .map((r) => cents(r.amount)),
      ),
      184143,
    );
    assert.equal(
      d.composition.find((r) => r.id === "chunky")!.amount,
      "6956.49",
    );
    assert.equal(
      d.composition.filter((r) => r.id === "chunky_difference").length,
      1,
    );
    assert.deepEqual(
      (await c.query("SELECT * FROM bank_movements WHERE id=$1", [bank])).rows,
      beforeBank,
    );
    assert.deepEqual(
      (
        await c.query(
          "SELECT * FROM cash_entries WHERE created_by=$1 ORDER BY id",
          [user],
        )
      ).rows,
      beforeCash,
    );
    const persisted = (
      await c.query(
        "SELECT * FROM allocations WHERE movement_id=$1 ORDER BY source_id",
        [bank],
      )
    ).rows;
    assert.equal(persisted.length, 4);
    const application = real.applications.find((a) => a.id === bank)!;
    for (const a of application.allocations) {
      const saved = persisted.find((r) => r.source_id === a.source)!;
      assert.equal(saved.principal, money(a.principal));
      assert.equal(saved.interest, money(a.interest));
      assert.equal(saved.feci, money(a.feci));
    }
    assert.equal(
      Number(
        (
          await c.query(
            "SELECT count(*) AS n FROM audit_log WHERE entity='composition' AND entity_id='chunky'",
          )
        ).rows[0].n,
      ),
      beforeAudit + 1,
    );
    const period = (
      await c.query("SELECT result FROM period_results WHERE period='2026-10'")
    ).rows[0].result;
    assert.equal(period.sources.chunky.opening, 695649);
    assert.equal(period.sources.costs.opening, 184143);
    assert.equal(application.amount, 15880);
  } finally {
    await c.query("ROLLBACK");
    c.release();
  }
});
