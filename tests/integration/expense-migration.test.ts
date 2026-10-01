import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { database } from "../../src/lib/db";
test("Separación de gastos conserva movimientos y auditoría; soporta escrituras durante predeploy", async () => {
  if (
    !process.env.DATABASE_URL ||
    !new URL(process.env.DATABASE_URL).pathname.endsWith("_test")
  )
    throw new Error("Usa una BD _test aislada.");
  const c = await database().connect();
  try {
    await c.query("BEGIN");
    await c.query(
      "CREATE TEMP TABLE cash_migration_test (LIKE cash_entries INCLUDING DEFAULTS INCLUDING CONSTRAINTS)",
    );
    await c.query("ALTER TABLE cash_migration_test DROP COLUMN ledger");
    await c.query(
      "CREATE TEMP TABLE audit_migration_test(user_id uuid,entity text,entity_id text,action text,before_data jsonb,after_data jsonb,reason text)",
    );
    const user = randomUUID();
    for (const [kind, category, amount, status, revision] of [
      ["EXPENSE", "NEEDS", "40.00", "void", 2],
      ["SAVING", "SAVINGS", "10.00", "active", 1],
      ["PAYROLL", "OTHER", "100.00", "active", 1],
    ])
      await c.query(
        "INSERT INTO cash_migration_test(id,request_key,occurred_on,period,kind,category,amount,concept,created_by,status,revision) VALUES($1,$2,'2026-10-01','2026-10',$3,$4,$5,'Movimiento conservado',$6,$7,$8)",
        [
          randomUUID(),
          randomUUID(),
          kind,
          category,
          amount,
          user,
          status,
          revision,
        ],
      );
    const before = (
      await c.query("SELECT * FROM cash_migration_test ORDER BY id")
    ).rows;
    const migration = (
      await readFile("migrations/007_expense_ledger.sql", "utf8")
    )
      .replaceAll("cash_entries", "cash_migration_test")
      .replaceAll("audit_log", "audit_migration_test")
      .replaceAll("cash_ledger_date", "cash_migration_idx")
      .replaceAll("assign_cash_ledger", "assign_migration_ledger")
      .replaceAll("cash_ledger_default", "migration_ledger_default");
    await c.query(migration);
    const after = (
      await c.query("SELECT * FROM cash_migration_test ORDER BY id")
    ).rows;
    assert.equal(after.length, 3);
    assert.deepEqual(
      after.map(({ ledger, ...r }) => r),
      before,
    );
    assert.ok(
      after.every(
        (r) => r.ledger === (r.kind === "PAYROLL" ? "BUDGET" : "EXPENSES"),
      ),
    );
    const audit = (await c.query("SELECT * FROM audit_migration_test")).rows;
    assert.equal(audit.length, 2);
    for (const row of audit) {
      const { ledger, ...rest } = row.after_data;
      assert.equal(ledger, "EXPENSES");
      assert.deepEqual(rest, row.before_data);
    }
    for (const [kind, ledger, expected] of [
      ["EXPENSE", null, "EXPENSES"],
      ["PAYROLL", null, "BUDGET"],
      ["EXPENSE", "BUDGET", "BUDGET"],
    ]) {
      const r = await c.query(
        "INSERT INTO cash_migration_test(id,request_key,occurred_on,period,kind,category,amount,concept,created_by,ledger) VALUES($1,$2,'2026-10-02','2026-10',$3,'WANTS',1,'Durante predeploy',$4,$5) RETURNING ledger",
        [randomUUID(), randomUUID(), kind, user, ledger],
      );
      assert.equal(r.rows[0].ledger, expected);
    }
  } finally {
    await c.query("ROLLBACK");
    c.release();
    await database().end();
  }
});
