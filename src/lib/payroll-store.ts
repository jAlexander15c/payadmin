import { randomUUID } from "node:crypto";
import Decimal from "decimal.js";
import type { PoolClient } from "pg";
import { transaction } from "./db";
import { HttpError } from "./auth";
import { audit, readData, materialize } from "./store";
import { cents, money, paramsAt, panamaToday } from "./finance";
import { payrollInput, payrollReceiptInput, payrollVoidInput } from "./payroll";
async function duplicate(
  c: PoolClient,
  table: "payroll_cycles" | "payroll_receipts",
  entity: string,
  v: { requestKey: string },
) {
  const found = await c.query(
    `SELECT id,status FROM ${table} WHERE request_key=$1`,
    [v.requestKey],
  );
  if (!found.rowCount) return null;
  if (found.rows[0].status !== "active")
    throw new HttpError(
      409,
      "Este registro ya fue anulado. Abre un formulario nuevo.",
    );
  const same = await c.query(
    "SELECT after_data->'input'=$3::jsonb AS equal FROM audit_log WHERE entity=$1 AND entity_id=$2 AND action='create' ORDER BY id LIMIT 1",
    [entity, found.rows[0].id, JSON.stringify(v)],
  );
  if (!same.rows[0]?.equal)
    throw new HttpError(
      409,
      "Este identificador ya se usó con datos distintos.",
    );
  return { id: found.rows[0].id, duplicate: true };
}
async function distribute(
  c: PoolClient,
  user: string,
  date: string,
  allocation: Record<string, string>,
  concept: string,
  cycle: string | null,
  receipt: string | null,
) {
  for (const [bucket, amount] of Object.entries(allocation)) {
    if (!cents(amount)) continue;
    const id = randomUUID();
    await c.query(
      "INSERT INTO cash_entries(id,request_key,occurred_on,period,kind,category,amount,concept,created_by,ledger,payroll_cycle_id,payroll_receipt_id) VALUES($1,$2,$3,$4,'INCOME',$5,$6,$7,$8,'EXPENSES',$9,$10)",
      [
        id,
        randomUUID(),
        date,
        date.slice(0, 7),
        bucket,
        amount,
        concept,
        user,
        cycle,
        receipt,
      ],
    );
    await audit(
      c,
      user,
      "expense",
      id,
      "create",
      null,
      { date, amount, bucket, payrollCycle: cycle, payrollReceipt: receipt },
      concept,
    );
  }
}
export async function confirmPayroll(
  raw: unknown,
  user: string,
  today = panamaToday(),
) {
  const v = payrollInput.parse(raw);
  if (v.date > today)
    throw new HttpError(
      400,
      "Confirma únicamente un salario que ya recibiste.",
    );
  return transaction(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(481512)");
    const old = await duplicate(c, "payroll_cycles", "payroll", v);
    if (old) return old;
    if (
      (
        await c.query(
          "SELECT 1 FROM payroll_cycles WHERE period=$1 AND half=$2 AND status='active'",
          [v.period, v.half],
        )
      ).rowCount
    )
      throw new HttpError(
        409,
        "Esta quincena ya está registrada. Anúlala desde Tu quincena si necesitas corregirla.",
      );
    const data = await readData(c),
      p = paramsAt(data.versions, v.period),
      id = randomUUID();
    const half = (date: string) => (Number(date.slice(8)) <= 15 ? "1" : "2");
    const existingBank = data.rawMovements.filter(
      (r) =>
        r.status === "active" &&
        r.type === "REGULAR" &&
        !data.payrollCycles.some(
          (c) => c.status === "active" && c.bank_movement_id === r.id,
        ) &&
        r.period === v.period &&
        half(r.date) === v.half,
    );
    const existingCash = data.cash.filter(
      (r) =>
        r.status === "active" &&
        r.kind === "PAYROLL" &&
        !data.payrollCycles.some(
          (c) => c.status === "active" && c.budget_cash_id === r.id,
        ) &&
        r.date.slice(0, 7) === v.period &&
        half(r.date) === v.half,
    );
    if (
      existingBank.length > 1 ||
      (existingBank.length === 1 &&
        cents(existingBank[0].amount) !== cents(v.deduction))
    )
      throw new HttpError(
        409,
        "Ya hay una deducción manual distinta para esta quincena. Revisa su importe antes de confirmar.",
      );
    if (
      existingCash.length > 1 ||
      (existingCash.length === 1 &&
        cents(existingCash[0].amount) !== cents(v.received))
    )
      throw new HttpError(
        409,
        "Ya hay una planilla manual distinta para esta quincena. Revisa su importe antes de confirmar.",
      );
    if (
      (
        await c.query(
          "SELECT 1 FROM bank_movements WHERE period=$1 AND status='active' AND type='NO_PAYMENT'",
          [v.period],
        )
      ).rowCount
    )
      throw new HttpError(
        409,
        "El mes está confirmado sin pago. Anula esa confirmación antes de registrar la deducción.",
      );
    const bankId =
        existingBank[0]?.id || (cents(v.deduction) > 0 ? randomUUID() : null),
      cashId = existingCash[0]?.id || randomUUID();
    if (bankId && !existingBank.length) {
      await c.query(
        "INSERT INTO bank_movements(id,request_key,occurred_on,period,type,amount,notes,created_by) VALUES($1,$2,$3,$4,'REGULAR',$5,$6,$7)",
        [
          bankId,
          randomUUID(),
          v.date,
          v.period,
          v.deduction,
          `Deducción salarial: quincena ${v.half} de ${v.period}. Chunky puede estar pendiente.`,
          user,
        ],
      );
      await audit(
        c,
        user,
        "bank",
        bankId,
        "create",
        null,
        { payroll: id, date: v.date, period: v.period, amount: v.deduction },
        "Deducción confirmada con la quincena",
      );
    }
    if (!existingCash.length) {
      await c.query(
        "INSERT INTO cash_entries(id,request_key,occurred_on,period,kind,category,amount,concept,created_by,ledger) VALUES($1,$2,$3,$4,'PAYROLL','OTHER',$5,$6,$7,'BUDGET')",
        [
          cashId,
          randomUUID(),
          v.date,
          v.period,
          v.received,
          `Planilla neta · ${v.period} / ${v.half}`,
          user,
        ],
      );
      await audit(
        c,
        user,
        "cash",
        cashId,
        "create",
        null,
        { payroll: id, date: v.date, amount: v.received },
        "Planilla neta confirmada",
      );
    }
    const expected =
      p.regular > 0
        ? new Decimal(cents(v.deduction))
            .mul(p.chunky)
            .div(p.regular)
            .toDecimalPlaces(0)
            .toNumber()
        : 0;
    await c.query(
      "INSERT INTO payroll_cycles(id,request_key,period,half,received_on,received_amount,deduction_amount,chunky_expected,next_due_on,bank_movement_id,budget_cash_id,owns_bank,owns_cash,allocation,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)",
      [
        id,
        v.requestKey,
        v.period,
        v.half,
        v.date,
        v.received,
        v.deduction,
        money(expected),
        v.nextDue,
        bankId,
        cashId,
        !existingBank.length,
        !existingCash.length,
        JSON.stringify(v.allocation),
        user,
      ],
    );
    await distribute(
      c,
      user,
      v.date,
      v.allocation,
      `Salario · ${v.period} / ${v.half}`,
      id,
      null,
    );
    await audit(
      c,
      user,
      "payroll",
      id,
      "create",
      null,
      { input: v, bankId, cashId, chunkyExpected: money(expected) },
      "Confirmación de salario, reparto y deducción en una sola operación",
    );
    await materialize(c, today);
    return { id, duplicate: false };
  });
}
export async function receiveChunky(
  raw: unknown,
  user: string,
  today = panamaToday(),
) {
  const v = payrollReceiptInput.parse(raw);
  if (v.date > today)
    throw new HttpError(400, "Registra únicamente dinero que ya recibiste.");
  return transaction(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(481512)");
    const old = await duplicate(c, "payroll_receipts", "payroll_receipt", v);
    if (old) return old;
    const cycle = (
      await c.query(
        "SELECT *,to_char(received_on,'YYYY-MM-DD') AS date FROM payroll_cycles WHERE id=$1 AND status='active' FOR UPDATE",
        [v.payrollId],
      )
    ).rows[0];
    if (!cycle) throw new HttpError(404, "Quincena inexistente o anulada.");
    if (v.date < cycle.date)
      throw new HttpError(
        400,
        "El cobro debe ser posterior o igual a la quincena confirmada.",
      );
    const received = await c.query(
      "SELECT coalesce(sum(amount),0) AS amount FROM payroll_receipts WHERE payroll_id=$1 AND status='active'",
      [v.payrollId],
    );
    if (
      cents(v.amount) >
      cents(cycle.chunky_expected) - cents(received.rows[0].amount)
    )
      throw new HttpError(
        409,
        "El cobro supera lo pendiente de esta quincena. Actualiza los datos o asigna el resto a otra quincena.",
      );
    const id = randomUUID(),
      contributionId = randomUUID();
    await c.query(
      "INSERT INTO contributions(id,request_key,occurred_on,period,source_id,contributor,amount,notes,created_by) VALUES($1,$2,$3,$4,'chunky','Chunky Bites',$5,$6,$7)",
      [
        contributionId,
        randomUUID(),
        v.date,
        cycle.period,
        v.amount,
        `Reembolso de deducción salarial · quincena ${cycle.half}. Distribuido en Mis gastos; no es otro pago bancario.`,
        user,
      ],
    );
    await c.query(
      "INSERT INTO payroll_receipts(id,request_key,payroll_id,contribution_id,received_on,amount,allocation,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        id,
        v.requestKey,
        v.payrollId,
        contributionId,
        v.date,
        v.amount,
        JSON.stringify(v.allocation),
        user,
      ],
    );
    await distribute(
      c,
      user,
      v.date,
      v.allocation,
      `Reembolso Chunky · ${cycle.period} / ${cycle.half}`,
      null,
      id,
    );
    await audit(
      c,
      user,
      "contribution",
      contributionId,
      "create",
      null,
      { payroll: v.payrollId, amount: v.amount, date: v.date },
      "Reembolso de Chunky recibido y distribuido",
    );
    await audit(
      c,
      user,
      "payroll_receipt",
      id,
      "create",
      null,
      { input: v, contributionId },
      "Cobro de Chunky y destino elegido",
    );
    await materialize(c, today);
    return { id, duplicate: false };
  });
}
export async function voidPayrollRecord(
  kind: "payroll" | "payroll_receipt",
  id: string,
  raw: unknown,
  user: string,
  today = panamaToday(),
) {
  const v = payrollVoidInput.parse(raw);
  return transaction(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(481512)");
    const table = kind === "payroll" ? "payroll_cycles" : "payroll_receipts";
    const before = (
      await c.query(`SELECT * FROM ${table} WHERE id=$1 FOR UPDATE`, [id])
    ).rows[0];
    if (!before) throw new HttpError(404, "Registro inexistente.");
    if (before.status === "void") return { id };
    if (kind === "payroll") {
      if (
        (
          await c.query(
            "SELECT 1 FROM payroll_receipts WHERE payroll_id=$1 AND status='active'",
            [id],
          )
        ).rowCount
      )
        throw new HttpError(
          409,
          "Anula primero los cobros de Chunky vinculados a esta quincena.",
        );
      if (before.owns_bank && before.bank_movement_id)
        await c.query(
          "UPDATE bank_movements SET status='void',revision=revision+1 WHERE id=$1",
          [before.bank_movement_id],
        );
      if (before.owns_cash)
        await c.query(
          "UPDATE cash_entries SET status='void',revision=revision+1 WHERE id=$1",
          [before.budget_cash_id],
        );
      await c.query(
        "UPDATE cash_entries SET status='void',revision=revision+1 WHERE payroll_cycle_id=$1 AND status='active'",
        [id],
      );
    } else {
      await c.query(
        "UPDATE contributions SET status='void',revision=revision+1 WHERE id=$1",
        [before.contribution_id],
      );
      await c.query(
        "UPDATE cash_entries SET status='void',revision=revision+1 WHERE payroll_receipt_id=$1 AND status='active'",
        [id],
      );
    }
    await c.query(`UPDATE ${table} SET status='void' WHERE id=$1`, [id]);
    await audit(
      c,
      user,
      kind,
      id,
      "void",
      before,
      { ...before, status: "void" },
      v.reason,
    );
    await materialize(c, today);
    return { id };
  });
}
