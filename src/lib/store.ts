import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { database, transaction } from "./db";
import { HttpError } from "./auth";
import { budgetFor } from "./budget";
import {
  bankInput,
  cashInput,
  contributionInput,
  correctionInput,
  paramsInput,
  responsibilityInput,
  statementInput,
  cashCompensationInput,
  cashCompensationCorrectionInput,
  fixedExpenseInput,
} from "./validation";
import { fixedExpensesAt } from "./budget";
import {
  capital,
  cents,
  money,
  pending,
  panamaToday,
  paramsAt,
  replay,
  scenarios,
  SOURCES,
  sum,
  INITIAL,
  addMonths,
  dueDate,
  applyCashCompensations,
  type Parameters,
  type Movement,
  type Statement,
} from "./finance";
import { firstDateInput } from "./validation";
type Queryable = Pick<PoolClient, "query">;
function cashApplications(
  d: Awaited<ReturnType<typeof readData>>,
  today: string,
) {
  return d.cashCompensations
    .filter((x) => x.status === "active" && x.date <= today)
    .map((x) => ({ id: x.id, date: x.date, amount: cents(x.amount) }));
}
export async function readData(c: Queryable = database()) {
  const [
    p,
    m,
    s,
    r,
    links,
    cash,
    participants,
    costs,
    history,
    audit,
    sources,
    loan,
    schedule,
    cashCompensations,
    fixedExpenses,
  ] = await (async () => [
    await c.query(
      "SELECT *,to_char(first_due,'YYYY-MM-DD') AS due FROM parameter_versions ORDER BY effective_period",
    ),
    await c.query(
      "SELECT *,to_char(occurred_on,'YYYY-MM-DD') AS date FROM bank_movements ORDER BY period,occurred_on,created_at,id",
    ),
    await c.query("SELECT * FROM statements ORDER BY period"),
    await c.query(
      "SELECT *,to_char(occurred_on,'YYYY-MM-DD') AS date FROM contributions ORDER BY occurred_on DESC,created_at DESC",
    ),
    await c.query(
      "SELECT l.* FROM contribution_links l JOIN bank_movements b ON b.id=l.movement_id WHERE b.status='active'",
    ),
    await c.query(
      "SELECT *,to_char(occurred_on,'YYYY-MM-DD') AS date FROM cash_entries ORDER BY occurred_on DESC,created_at DESC",
    ),
    await c.query(
      "SELECT * FROM responsibility_versions ORDER BY effective_period",
    ),
    await c.query("SELECT * FROM composition ORDER BY id"),
    await c.query("SELECT * FROM legacy_chunky ORDER BY period"),
    await c.query(
      "SELECT id,entity,entity_id,action,reason,created_at,before_data,after_data FROM audit_log ORDER BY id DESC LIMIT 100",
    ),
    await c.query("SELECT * FROM sources ORDER BY id"),
    await c.query("SELECT * FROM loans WHERE id=1"),
    await c.query(
      "SELECT *,to_char(first_due,'YYYY-MM-DD') AS due FROM loan_schedule_versions ORDER BY created_at,id",
    ),
    await c.query(
      "SELECT x.*,to_char(r.occurred_on,'YYYY-MM-DD') AS date,r.contributor,r.source_id,r.status AS receipt_status FROM cash_compensations x JOIN contributions r ON r.id=x.contribution_id ORDER BY r.occurred_on,x.created_at,x.id",
    ),
    await c.query(
      "SELECT v.*,f.revision FROM fixed_expense_versions v JOIN fixed_expenses f ON f.id=v.fixed_id ORDER BY v.effective_period,v.name",
    ),
  ])();
  if (
    sources.rows.length !== 4 ||
    sources.rows.some(
      (v) => cents(v.initial_capital) !== INITIAL[v.id as keyof typeof INITIAL],
    ) ||
    !loan.rows[0] ||
    cents(loan.rows[0].initial_capital) !== sum(Object.values(INITIAL))
  )
    throw new Error(
      "La composición inicial de PostgreSQL difiere de los datos definitivos. Revisa la migración sin forzar ajustes.",
    );
  const versions: Parameters[] = p.rows.map((v) => ({
    effectivePeriod: v.effective_period,
    interest: v.annual_interest,
    feci: v.annual_feci,
    regular: cents(v.regular_payment),
    chunky: cents(v.chunky_payment),
    credi: cents(v.credi_payment),
    firstDue: schedule.rows.at(-1)?.due ?? v.due,
    provisional: schedule.rows.length ? false : v.provisional,
    originalFirstDue: v.due,
    originalProvisional: v.provisional,
    salary: cents(v.salary),
    salaryIncludesLoan: v.salary_includes_loan,
  }));
  const movements: Movement[] = m.rows
    .filter((v) => v.status === "active")
    .map((v) => ({
      id: v.id,
      date: v.date,
      period: v.period,
      type: v.type,
      amount: cents(v.amount),
      notes: v.notes,
    }));
  const statements: Statement[] = s.rows.map((v) => ({
    period: v.period,
    interest: v.interest === null ? null : cents(v.interest),
    feci: v.feci === null ? null : cents(v.feci),
    other: v.other_charges === null ? null : cents(v.other_charges),
    concept: v.other_concept,
    principal: v.principal_paid === null ? null : cents(v.principal_paid),
    balance: v.reported_balance === null ? null : cents(v.reported_balance),
  }));
  return {
    versions,
    movements,
    statements,
    rawMovements: m.rows,
    contributions: r.rows,
    links: links.rows,
    cash: cash.rows,
    participants: participants.rows,
    composition: costs.rows,
    history: history.rows,
    audit: audit.rows,
    sources: sources.rows,
    loan: loan.rows[0],
    scheduleVersions: schedule.rows,
    cashCompensations: cashCompensations.rows,
    fixedExpenses: fixedExpenses.rows,
  };
}
export async function confirmFirstDate(
  raw: unknown,
  user: string,
  today = panamaToday(),
) {
  const v = firstDateInput.parse(raw);
  return locked(async (c) => {
    const d = await readData(c),
      previous = d.versions[0];
    if (v.date.slice(0, 7) !== previous.firstDue.slice(0, 7))
      throw new HttpError(
        409,
        "La confirmación debe conservar el mes de inicio. Cambiarlo requiere corregir explícitamente los períodos afectados, no reescribirlos automáticamente.",
      );
    await c.query(
      "INSERT INTO loan_schedule_versions(id,first_due,created_by) VALUES($1,$2,$3)",
      [randomUUID(), v.date, user],
    );
    await audit(
      c,
      user,
      "first_due",
      "1",
      "confirm",
      { date: previous.firstDue, provisional: previous.provisional },
      { date: v.date, provisional: false },
      v.reason,
    );
    await materialize(c, today);
    return { date: v.date };
  });
}
function control(
  id: number,
  label: string,
  amount: number | null,
  ok: boolean | null,
  explanation: string,
) {
  return {
    id,
    label,
    amount,
    status: ok === null ? "pending" : ok ? "pass" : "fail",
    explanation,
  };
}
export async function snapshot(asOf = panamaToday()) {
  return transaction(async (c) => {
    await c.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    const data = await readData(c);
    const model = scenarios(
        data.movements,
        data.statements,
        data.versions,
        asOf,
        cashApplications(data, asOf),
      ),
      l = model.real;
    const latest = l.periods.at(-1),
      p = paramsAt(data.versions, asOf.slice(0, 7));
    const fees = sum(
      data.composition
        .filter((x) => x.kind === "expense")
        .map((x) => cents(x.amount)),
    );
    const received = sum(
      data.contributions
        .filter((x) => x.status === "active")
        .map((x) => cents(x.amount)),
    );
    const linked =
      sum(data.links.map((x) => cents(x.amount))) +
      sum(
        data.cashCompensations
          .filter((x) => x.status === "active")
          .map((x) => cents(x.amount)),
      );
    const reg = sum(
      l.applications
        .filter((x) => x.type === "REGULAR")
        .map((x) => x.principal),
    );
    const allPaidInterest = sum(SOURCES.map((s) => l.bags[s].paidInterest)),
      allPaidFeci = sum(SOURCES.map((s) => l.bags[s].paidFeci)),
      allPaidOther = sum(SOURCES.map((s) => l.bags[s].paidOther));
    const controls = [
      control(
        1,
        "Deudas consolidadas",
        sum(
          data.composition
            .filter((x) => x.kind === "debt")
            .map((x) => cents(x.amount)),
        ),
        sum(
          data.composition
            .filter((x) => x.kind === "debt")
            .map((x) => cents(x.amount)),
        ) === 1637642,
        "Tres fuentes iniciales: $16,376.42.",
      ),
      control(
        2,
        "Composición financiada",
        sum(Object.values(INITIAL)),
        sum(data.composition.map((x) => cents(x.amount))) === 1815000,
        "Deudas + gastos + interés cotizado + efectivo. No hay pagos históricos en esta suma.",
      ),
      control(
        3,
        "Tarjetas personales",
        sum(
          data.composition
            .filter((x) => x.source_id === "cards")
            .map((x) => cents(x.amount)),
        ),
        sum(
          data.composition
            .filter((x) => x.source_id === "cards")
            .map((x) => cents(x.amount)),
        ) === 800308,
        "Banco General + Lafise + Banesco.",
      ),
      control(
        4,
        "Gastos iniciales",
        fees,
        fees === 142885,
        "Se suman conceptos, sin volver a sumar subtotales. $27.13 es efectivo recibido.",
      ),
      control(
        5,
        "Cuotas regulares fijas",
        p.chunky + (p.regular - p.chunky),
        true,
        `Chunky ${money(p.chunky)} + Javier ${money(p.regular - p.chunky)} = ${money(p.regular)} USD. No incluye CrediJamar.`,
      ),
      control(
        6,
        "Capital inicial − regular − extras",
        capital(l),
        1815000 - reg - l.extraPrincipal === capital(l),
        "Solo se resta el capital realmente aplicado.",
      ),
      control(
        7,
        "Cuatro saldos = capital BG",
        capital(l),
        sum(SOURCES.map((s) => l.bags[s].capital)) === 1815000 - l.principal,
        "Responsabilidades internas de un único préstamo legal.",
      ),
      control(
        8,
        "Capital distribuido = aplicado",
        l.principal,
        sum(
          l.applications.flatMap((x) => x.allocations.map((a) => a.principal)),
        ) === l.principal,
        "Cada asignación conserva los centavos.",
      ),
      control(
        9,
        "Compensaciones sin doble cobro",
        l.advance,
        sum(l.applications.map((x) => x.advance - x.compensation)) -
          sum((l.cashCompensations || []).map((x) => x.applied)) ===
          l.advance && !(l.cashCompensations || []).some((x) => x.excess > 0),
        "Adelantos financiados menos compensaciones bancarias y reembolsos recibidos al cancelar. No son nuevos intereses bancarios.",
      ),
      control(
        10,
        "Saldos no negativos",
        capital(l),
        SOURCES.every(
          (s) => l.bags[s].capital >= 0 && l.bags[s].capital <= INITIAL[s],
        ) && l.advance >= 0,
        "Los abonos se limitan al capital del destino; el exceso queda separado.",
      ),
      control(
        11,
        "CrediJamar: máximo 24 meses",
        model.current.sections.credi.remainingAtDeadline,
        model.current.sections.credi.remainingAtDeadline === 0,
        model.current.sections.credi.remainingAtDeadline
          ? "ERROR: CREDIJAMAR DEBE ESTAR LIQUIDADO EN 24 MESES. Faltante proyectado al límite."
          : "Plan proyectado dentro del límite; no equivale a liquidación real.",
      ),
      control(
        12,
        "Chunky: máximo 02/06/2031",
        model.current.sections.chunky.remainingAtDeadline,
        model.current.sections.chunky.remainingAtDeadline === 0,
        "La cuota permanece fija; se informa el extra necesario si el plan incumple.",
      ),
      control(
        13,
        "Saldo calculado vs bancario",
        latest?.balanceDifference ?? null,
        latest?.balanceDifference == null
          ? null
          : latest.balanceDifference === 0,
        "Sin extracto se conserva como desconocido. No se ajusta automáticamente el capital.",
      ),
      control(
        14,
        "Pago explicado por capital, cargos y exceso",
        l.paid,
        l.paid ===
          l.principal + allPaidInterest + allPaidFeci + allPaidOther + l.excess,
        "Cuadre del efectivo bancario real.",
      ),
      control(
        15,
        "Aportes recibidos sin duplicar pagos",
        received - linked,
        linked <= received,
        "Recibido pendiente de vincular. Registrar un aporte no reduce capital ni aumenta pagos BG.",
      ),
      control(
        16,
        "Información provisional o faltante",
        null,
        p.provisional || l.periods.some((x) => x.status === "unknown")
          ? null
          : true,
        "Primer vencimiento provisional; meses sin registro son desconocidos, no pagos cero. Cargos sin extracto son estimaciones.",
      ),
      control(
        17,
        "Cotización oficial vs simulación",
        p.regular - model.mathematicalPayment,
        true,
        `84 meses oficiales; ${model.regular.payments} pagos matemáticos base. La diferencia inicial no es ahorro por abonos.`,
      ),
    ];
    const budgetPeriod =
      asOf.slice(0, 7) < data.versions[0].firstDue.slice(0, 7)
        ? data.versions[0].firstDue.slice(0, 7)
        : asOf.slice(0, 7);
    return {
      ...data,
      ...model,
      initialBudget: budgetFor({ ...data, ...model }, budgetPeriod, "1"),
      asOf,
      parameters: p,
      controls,
      totals: {
        paidInterest: allPaidInterest,
        paidFeci: allPaidFeci,
        paidOther: allPaidOther,
        pending: pending(l),
        capital: capital(l),
        received,
        linked,
      },
      database: "connected",
    };
  });
}
async function audit(
  c: PoolClient,
  user: string,
  entity: string,
  id: string,
  action: string,
  before: unknown,
  after: unknown,
  reason: string,
) {
  await c.query(
    "INSERT INTO audit_log(user_id,entity,entity_id,action,before_data,after_data,reason) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [
      user,
      entity,
      id,
      action,
      JSON.stringify(before),
      JSON.stringify(after),
      reason,
    ],
  );
}
async function locked<T>(fn: (c: PoolClient) => Promise<T>) {
  return transaction(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(481512)");
    return fn(c);
  });
}
async function validateFixedPayment(
  c: PoolClient,
  v: ReturnType<typeof cashInput.parse>,
) {
  if (!v.fixedExpenseId) return;
  const versions = await c.query(
    "SELECT * FROM fixed_expense_versions WHERE fixed_id=$1 ORDER BY effective_period",
    [v.fixedExpenseId],
  );
  const item = fixedExpensesAt(versions.rows, v.period)[0];
  if (!item?.active)
    throw new HttpError(
      409,
      "Este gasto fijo no está activo en el mes del pago.",
    );
}
export async function saveFixedExpense(raw: unknown, user: string) {
  const v = fixedExpenseInput.parse(raw);
  return locked(async (c) => {
    let id = v.id;
    let before: unknown = null;
    if (!id) {
      const existing = await c.query(
        "SELECT id FROM fixed_expenses WHERE request_key=$1",
        [v.requestKey],
      );
      if (existing.rowCount) {
        const same = await c.query(
          "SELECT after_data=$2::jsonb AS equal FROM audit_log WHERE entity='fixed_expense' AND entity_id=$1 AND action='create' ORDER BY id LIMIT 1",
          [existing.rows[0].id, JSON.stringify(v)],
        );
        if (!same.rows[0]?.equal)
          throw new HttpError(
            409,
            "Este identificador ya se usó con datos distintos.",
          );
        return { id: existing.rows[0].id, duplicate: true };
      }
      id = randomUUID();
      await c.query(
        "INSERT INTO fixed_expenses(id,request_key) VALUES($1,$2)",
        [id, v.requestKey],
      );
    } else {
      const parent = await c.query(
        "SELECT revision FROM fixed_expenses WHERE id=$1 FOR UPDATE",
        [id],
      );
      if (!parent.rowCount) throw new HttpError(404, "Gasto fijo inexistente.");
      if (parent.rows[0].revision !== v.revision)
        throw new HttpError(
          409,
          "El gasto fijo cambió. Actualiza antes de editar.",
        );
      before = (
        await c.query(
          "SELECT * FROM fixed_expense_versions WHERE fixed_id=$1 ORDER BY effective_period",
          [id],
        )
      ).rows;
      await c.query(
        "UPDATE fixed_expenses SET revision=revision+1 WHERE id=$1",
        [id],
      );
    }
    await c.query(
      "INSERT INTO fixed_expense_versions(id,fixed_id,effective_period,name,amount,due_day,active,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(fixed_id,effective_period) DO UPDATE SET name=excluded.name,amount=excluded.amount,due_day=excluded.due_day,active=excluded.active,created_by=excluded.created_by,created_at=now()",
      [
        randomUUID(),
        id,
        v.effectivePeriod,
        v.name,
        v.amount,
        v.dueDay,
        v.active,
        user,
      ],
    );
    await audit(
      c,
      user,
      "fixed_expense",
      id,
      v.id ? "update" : "create",
      before,
      v,
      "Configuración de gasto fijo por mes de vigencia",
    );
    return { id, duplicate: false };
  });
}
function realDate(date: string, period: string, start: string, today: string) {
  if (date > today)
    throw new HttpError(
      400,
      "Un movimiento real no puede tener fecha futura. Usa el simulador.",
    );
  if (period < start || date < `${start}-01`)
    throw new HttpError(
      400,
      "El movimiento pertenece al préstamo anterior o precede al inicio.",
    );
  if (period > today.slice(0, 7))
    throw new HttpError(400, "Un período futuro solo puede proyectarse.");
}
async function validateLinks(c: PoolClient) {
  const invalid = await c.query(`SELECT r.id FROM contributions r LEFT JOIN (
 SELECT l.contribution_id,sum(l.amount) amount FROM contribution_links l JOIN bank_movements b ON b.id=l.movement_id WHERE b.status='active' GROUP BY l.contribution_id
 UNION ALL SELECT contribution_id,sum(amount) FROM cash_compensations WHERE status='active' GROUP BY contribution_id
 ) used ON used.contribution_id=r.id
 GROUP BY r.id HAVING coalesce(sum(used.amount),0)>r.amount OR (r.status='void' AND coalesce(sum(used.amount),0)>0)`);
  if (invalid.rowCount)
    throw new HttpError(
      409,
      "El aporte ya tiene aplicaciones. Corrige primero sus vínculos o compensaciones; no se puede aplicar más de lo recibido.",
    );
  const bad =
    await c.query(`SELECT b.id FROM bank_movements b JOIN contribution_links l ON l.movement_id=b.id
 WHERE b.status='active' GROUP BY b.id HAVING sum(l.amount)>b.amount`);
  if (bad.rowCount)
    throw new HttpError(409, "Los vínculos superan el pago bancario.");
  const future = await c.query(
    `SELECT l.movement_id FROM contribution_links l JOIN bank_movements b ON b.id=l.movement_id JOIN contributions r ON r.id=l.contribution_id WHERE b.status='active' AND (r.occurred_on>b.occurred_on OR r.status='void')`,
  );
  if (future.rowCount)
    throw new HttpError(
      409,
      "No se puede aplicar un aporte antes de recibirlo o después de anularlo.",
    );
}
async function materialize(c: PoolClient, today: string) {
  await validateLinks(c);
  const d = await readData(c),
    l = replay(d.movements, d.statements, d.versions, today);
  const items = cashApplications(d, today);
  if (items.length) {
    const bankClose = l.applications
      .filter((a) => a.principal + a.interest + a.feci + a.other > 0)
      .at(-1)?.date;
    if (
      capital(l) > 0 ||
      pending(l) > 0 ||
      d.cashCompensations.some(
        (x) =>
          x.status === "active" &&
          (x.source_id !== "credi" ||
            x.receipt_status !== "active" ||
            !bankClose ||
            x.date < bankClose),
      )
    )
      throw new HttpError(
        409,
        "La compensación en efectivo exige el préstamo bancario saldado y un aporte CrediJamar recibido después. Revisa o anula esa compensación antes de reabrir el préstamo.",
      );
    applyCashCompensations(l, items);
  }
  await c.query("DELETE FROM allocations");
  await c.query("DELETE FROM compensations");
  await c.query("DELETE FROM period_results");
  for (const a of l.applications) {
    for (const x of a.allocations)
      await c.query("INSERT INTO allocations VALUES($1,$2,$3,$4,$5,$6,$7,$8)", [
        a.id,
        x.source,
        money(x.principal),
        money(x.interest),
        money(x.feci),
        money(x.other),
        money(x.compensation),
        money(x.advance),
      ]);
    await c.query("INSERT INTO compensations VALUES($1,$2,$3,$4)", [
      a.id,
      money(a.advance),
      money(a.compensation),
      money(a.pendingAdvance),
    ]);
  }
  for (const r of l.periods)
    await c.query("INSERT INTO period_results(period,result) VALUES($1,$2)", [
      r.period,
      JSON.stringify(r),
    ]);
  if (
    1815000 - l.principal !== capital(l) ||
    l.paid !==
      l.principal +
        sum(l.applications.map((x) => x.interest + x.feci + x.other + x.excess))
  )
    throw new Error("Fallo de reconciliación financiera.");
}
export async function createRecord(
  kind: "bank" | "contribution" | "cash",
  raw: unknown,
  user: string,
  today = panamaToday(),
) {
  return locked(async (c) => {
    const parsed =
      kind === "bank"
        ? bankInput.parse(raw)
        : kind === "contribution"
          ? contributionInput.parse(raw)
          : cashInput.parse(raw);
    const table =
      kind === "bank"
        ? "bank_movements"
        : kind === "contribution"
          ? "contributions"
          : "cash_entries";
    const existing = await c.query(
      `SELECT id FROM ${table} WHERE request_key=$1`,
      [parsed.requestKey],
    );
    if (existing.rowCount) {
      const creation = await c.query(
        "SELECT after_data FROM audit_log WHERE entity=$1 AND entity_id=$2 AND action='create' ORDER BY id LIMIT 1",
        [kind, existing.rows[0].id],
      );
      if (
        JSON.stringify(creation.rows[0]?.after_data) !==
        JSON.stringify(JSON.parse(JSON.stringify(parsed)))
      ) {
        // JSONB key ordering differs from JS; compare canonical representations.
        const equal = await c.query("SELECT $1::jsonb = $2::jsonb AS equal", [
          JSON.stringify(creation.rows[0]?.after_data),
          JSON.stringify(parsed),
        ]);
        if (!equal.rows[0].equal)
          throw new HttpError(
            409,
            "Este identificador ya se usó con datos distintos.",
          );
      }
      return { id: existing.rows[0].id, duplicate: true };
    }
    const versions = (await readData(c)).versions;
    realDate(
      parsed.date,
      parsed.period,
      kind === "bank" ? versions[0].firstDue.slice(0, 7) : "2000-01",
      today,
    );
    const id = randomUUID();
    if (kind === "bank") {
      const v = bankInput.parse(raw);
      if (v.type === "NO_PAYMENT" && cents(v.amount) !== 0)
        throw new HttpError(400, "Sin pago confirmado requiere importe cero.");
      if (v.type !== "NO_PAYMENT" && cents(v.amount) === 0)
        throw new HttpError(
          400,
          "Un pago debe ser positivo. Para cero usa Sin pago confirmado.",
        );
      const contradictory = await c.query(
        "SELECT 1 FROM bank_movements WHERE period=$1 AND status='active' AND (($2='NO_PAYMENT' AND type<>'NO_PAYMENT') OR ($2<>'NO_PAYMENT' AND type='NO_PAYMENT'))",
        [v.period, v.type],
      );
      if (contradictory.rowCount)
        throw new HttpError(
          409,
          "El período está confirmado sin pago o ya tiene pagos. Anula la confirmación incorrecta antes de continuar.",
        );
      await c.query(
        "INSERT INTO bank_movements(id,request_key,occurred_on,period,type,amount,notes,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [id, v.requestKey, v.date, v.period, v.type, v.amount, v.notes, user],
      );
      for (const link of v.links)
        await c.query("INSERT INTO contribution_links VALUES($1,$2,$3)", [
          id,
          link.id,
          link.amount,
        ]);
    } else if (kind === "contribution") {
      const v = contributionInput.parse(raw);
      await c.query(
        "INSERT INTO contributions(id,request_key,occurred_on,period,source_id,contributor,amount,notes,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [
          id,
          v.requestKey,
          v.date,
          v.period,
          v.source,
          v.contributor,
          v.amount,
          v.notes,
          user,
        ],
      );
    } else {
      const v = cashInput.parse(raw);
      await validateFixedPayment(c, v);
      await c.query(
        "INSERT INTO cash_entries(id,request_key,occurred_on,period,kind,category,amount,concept,created_by,funding,fixed_expense_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
        [
          id,
          v.requestKey,
          v.date,
          v.period,
          v.kind,
          v.category,
          v.amount,
          v.concept,
          user,
          v.funding,
          v.fixedExpenseId,
        ],
      );
    }
    await audit(
      c,
      user,
      kind,
      id,
      "create",
      null,
      parsed,
      "Registro de movimiento real",
    );
    await materialize(c, today);
    return { id, duplicate: false };
  });
}
export async function createCashCompensation(
  raw: unknown,
  user: string,
  today = panamaToday(),
) {
  const v = cashCompensationInput.parse(raw);
  return locked(async (c) => {
    const existing = await c.query(
      "SELECT id FROM cash_compensations WHERE request_key=$1",
      [v.requestKey],
    );
    if (existing.rowCount) {
      const same = await c.query(
        "SELECT after_data=$2::jsonb AS equal FROM audit_log WHERE entity='cash_compensation' AND entity_id=$1 AND action='create' ORDER BY id LIMIT 1",
        [existing.rows[0].id, JSON.stringify(v)],
      );
      if (!same.rows[0]?.equal)
        throw new HttpError(
          409,
          "Este identificador ya se usó con datos distintos.",
        );
      return { id: existing.rows[0].id, duplicate: true };
    }
    const d = await readData(c),
      l = applyCashCompensations(
        replay(d.movements, d.statements, d.versions, today),
        cashApplications(d, today),
      );
    const r = d.contributions.find((x) => x.id === v.receiptId);
    if (
      !r ||
      r.status !== "active" ||
      r.source_id !== "credi" ||
      r.date > today
    )
      throw new HttpError(
        400,
        "Selecciona un aporte CrediJamar recibido y activo.",
      );
    if (cents(v.amount) > l.advance)
      throw new HttpError(
        409,
        "El reembolso supera los cargos pendientes adelantados por Javier.",
      );
    const id = randomUUID();
    await c.query(
      "INSERT INTO cash_compensations(id,request_key,contribution_id,amount,created_by) VALUES($1,$2,$3,$4,$5)",
      [id, v.requestKey, v.receiptId, v.amount, user],
    );
    await audit(c, user, "cash_compensation", id, "create", null, v, v.reason);
    await materialize(c, today);
    return { id, duplicate: false };
  });
}
export async function correctCashCompensation(
  id: string,
  raw: unknown,
  user: string,
  today = panamaToday(),
) {
  const v = cashCompensationCorrectionInput.parse(raw);
  return locked(async (c) => {
    const row = await c.query(
        "SELECT * FROM cash_compensations WHERE id=$1 FOR UPDATE",
        [id],
      ),
      before = row.rows[0];
    if (!before) throw new HttpError(404, "Compensación inexistente.");
    if (before.status !== "active" || before.revision !== v.revision)
      throw new HttpError(
        409,
        "El registro cambió; actualiza antes de corregirlo.",
      );
    if (v.action === "correct") {
      const d = await readData(c),
        l = applyCashCompensations(
          replay(d.movements, d.statements, d.versions, today),
          cashApplications(d, today).filter((x) => x.id !== id),
        );
      if (cents(v.amount!) > l.advance)
        throw new HttpError(
          409,
          "El reembolso supera el adelanto pendiente de Javier.",
        );
    }
    const updated = await c.query(
      "UPDATE cash_compensations SET amount=coalesce($2,amount),status=$3,revision=revision+1 WHERE id=$1 RETURNING *",
      [
        id,
        v.action === "correct" ? v.amount : null,
        v.action === "void" ? "void" : "active",
      ],
    );
    await audit(
      c,
      user,
      "cash_compensation",
      id,
      v.action,
      before,
      updated.rows[0],
      v.reason,
    );
    await materialize(c, today);
    return { id, revision: updated.rows[0].revision };
  });
}
export async function correctRecord(
  kind: "bank" | "contribution" | "cash",
  id: string,
  raw: unknown,
  user: string,
  today = panamaToday(),
) {
  const v = correctionInput.parse(raw);
  return locked(async (c) => {
    const table =
      kind === "bank"
        ? "bank_movements"
        : kind === "contribution"
          ? "contributions"
          : "cash_entries";
    const result = await c.query(
        `SELECT * FROM ${table} WHERE id=$1 FOR UPDATE`,
        [id],
      ),
      before = result.rows[0];
    if (!before) throw new HttpError(404, "Movimiento inexistente.");
    if (before.revision !== v.revision)
      throw new HttpError(
        409,
        "El movimiento cambió. Actualiza antes de corregir.",
      );
    if (before.status === "void")
      throw new HttpError(409, "El movimiento ya está anulado.");
    if (v.action === "void")
      await c.query(
        `UPDATE ${table} SET status='void',revision=revision+1 WHERE id=$1`,
        [id],
      );
    else {
      const parsed =
        kind === "bank"
          ? bankInput.parse(v.data)
          : kind === "contribution"
            ? contributionInput.parse(v.data)
            : cashInput.parse(v.data);
      const start = (await readData(c)).versions[0].firstDue.slice(0, 7);
      realDate(
        parsed.date,
        parsed.period,
        kind === "bank" ? start : "2000-01",
        today,
      );
      if (kind === "bank") {
        const b = bankInput.parse(v.data);
        if ((b.type === "NO_PAYMENT") !== (cents(b.amount) === 0))
          throw new HttpError(400, "El tipo y el importe no coinciden.");
        const conflict = await c.query(
          "SELECT 1 FROM bank_movements WHERE id<>$3 AND period=$1 AND status='active' AND (($2='NO_PAYMENT' AND type<>'NO_PAYMENT') OR ($2<>'NO_PAYMENT' AND type='NO_PAYMENT'))",
          [b.period, b.type, id],
        );
        if (conflict.rowCount)
          throw new HttpError(
            409,
            "El período tiene una confirmación incompatible.",
          );
        await c.query(
          "UPDATE bank_movements SET occurred_on=$2,period=$3,type=$4,amount=$5,notes=$6,revision=revision+1,updated_at=now() WHERE id=$1",
          [id, b.date, b.period, b.type, b.amount, b.notes],
        );
        await c.query("DELETE FROM contribution_links WHERE movement_id=$1", [
          id,
        ]);
        for (const link of b.links)
          await c.query("INSERT INTO contribution_links VALUES($1,$2,$3)", [
            id,
            link.id,
            link.amount,
          ]);
      } else if (kind === "contribution") {
        const r = contributionInput.parse(v.data);
        await c.query(
          "UPDATE contributions SET occurred_on=$2,period=$3,source_id=$4,contributor=$5,amount=$6,notes=$7,revision=revision+1 WHERE id=$1",
          [id, r.date, r.period, r.source, r.contributor, r.amount, r.notes],
        );
      } else {
        const b = cashInput.parse(v.data);
        await validateFixedPayment(c, b);
        await c.query(
          "UPDATE cash_entries SET occurred_on=$2,period=$3,kind=$4,category=$5,amount=$6,concept=$7,funding=$8,fixed_expense_id=$9,revision=revision+1 WHERE id=$1",
          [
            id,
            b.date,
            b.period,
            b.kind,
            b.category,
            b.amount,
            b.concept,
            b.funding,
            b.fixedExpenseId,
          ],
        );
      }
    }
    const after = (await c.query(`SELECT * FROM ${table} WHERE id=$1`, [id]))
      .rows[0];
    await audit(c, user, kind, id, v.action, before, after, v.reason);
    await materialize(c, today);
    return { id };
  });
}
export async function saveStatement(
  raw: unknown,
  user: string,
  today = panamaToday(),
) {
  const v = statementInput.parse(raw);
  return locked(async (c) => {
    const start = (await readData(c)).versions[0].firstDue.slice(0, 7);
    if (v.period < start || v.period > today.slice(0, 7))
      throw new HttpError(
        400,
        "El extracto debe corresponder a un período real del préstamo.",
      );
    const before =
      (await c.query("SELECT * FROM statements WHERE period=$1", [v.period]))
        .rows[0] || null;
    await c.query(
      `INSERT INTO statements(period,interest,feci,other_charges,other_concept,principal_paid,reported_balance,notes,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
   ON CONFLICT(period) DO UPDATE SET interest=$2,feci=$3,other_charges=$4,other_concept=$5,principal_paid=$6,reported_balance=$7,notes=$8,updated_by=$9,updated_at=now()`,
      [
        v.period,
        v.interest,
        v.feci,
        v.other,
        v.concept,
        v.principal,
        v.balance,
        v.notes,
        user,
      ],
    );
    await audit(c, user, "statement", v.period, "confirm", before, v, v.reason);
    await materialize(c, today);
    return { period: v.period };
  });
}
export async function saveParameters(
  raw: unknown,
  user: string,
  today = panamaToday(),
) {
  const v = paramsInput.parse(raw);
  return locked(async (c) => {
    const data = await readData(c),
      start = data.versions[0];
    const existing = await c.query(
      "SELECT * FROM parameter_versions WHERE effective_period=$1",
      [v.effectivePeriod],
    );
    const hasHistory = data.movements.length > 0 || data.statements.length > 0;
    if (data.scheduleVersions.length && v.firstDue !== start.firstDue)
      throw new HttpError(
        409,
        "La fecha inicial ya fue confirmada. Corrígela desde Confirmar primer vencimiento, conservando el mes y la auditoría.",
      );
    if (v.firstDue !== start.firstDue && hasHistory)
      throw new HttpError(
        409,
        "La fecha inicial no puede cambiar tras registrar pagos o extractos. Conserva la historia.",
      );
    if (
      hasHistory &&
      (v.effectivePeriod <= today.slice(0, 7) ||
        data.movements.some((m) => m.period >= v.effectivePeriod) ||
        existing.rowCount)
    )
      throw new HttpError(
        409,
        "Una nueva versión debe regir en un período futuro sin movimientos. No se reescribe la historia.",
      );
    if (!hasHistory && v.effectivePeriod !== v.firstDue.slice(0, 7))
      throw new HttpError(
        400,
        "La primera versión debe coincidir con el mes del primer vencimiento.",
      );
    if (!hasHistory) {
      await c.query("DELETE FROM parameter_versions");
    }
    await c.query(
      "INSERT INTO parameter_versions(id,effective_period,annual_interest,annual_feci,regular_payment,chunky_payment,credi_payment,first_due,provisional,salary,salary_includes_loan,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
      [
        randomUUID(),
        v.effectivePeriod,
        v.interest,
        v.feci,
        v.regular,
        v.chunky,
        v.credi,
        v.firstDue,
        v.provisional,
        v.salary,
        v.salaryIncludesLoan,
        user,
      ],
    );
    await audit(
      c,
      user,
      "parameters",
      v.effectivePeriod,
      hasHistory ? "version" : "initial-correction",
      data.versions,
      v,
      v.reason,
    );
    await materialize(c, today);
    return { period: v.effectivePeriod };
  });
}
export async function saveResponsibilities(
  raw: unknown,
  user: string,
  today = panamaToday(),
) {
  const v = responsibilityInput.parse(raw);
  return locked(async (c) => {
    if (v.effectivePeriod < today.slice(0, 7))
      throw new HttpError(
        400,
        "La responsabilidad nueva no puede reescribir períodos anteriores.",
      );
    const exists = await c.query(
      "SELECT 1 FROM responsibility_versions WHERE effective_period=$1",
      [v.effectivePeriod],
    );
    if (exists.rowCount)
      throw new HttpError(
        409,
        "Ya existe una versión para ese período. Crea una vigencia nueva.",
      );
    await c.query(
      "INSERT INTO responsibility_versions(id,effective_period,participants,created_by) VALUES($1,$2,$3,$4)",
      [randomUUID(), v.effectivePeriod, JSON.stringify(v.participants), user],
    );
    await audit(
      c,
      user,
      "responsibility",
      v.effectivePeriod,
      "version",
      null,
      v,
      v.reason,
    );
    return { period: v.effectivePeriod };
  });
}
