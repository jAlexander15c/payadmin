"use client";
import { useEffect, useRef, useState } from "react";
import { Plus, X, Info, Pencil, Download } from "lucide-react";
import { budgetFor, fixedExpensesAt } from "@/lib/budget";
import { cents } from "@/lib/finance";
import { type Snapshot, usd, displayDate, typeNames } from "./dashboard";
import BudgetCategories from "./budget-categories";
import FundTotals from "./fund-totals";
type Row = Record<string, any>;
type Form = { type: "fixed" | "expense" | "saving"; item?: Row };
export default function Expenses({
  d,
  onSaved,
  edit,
}: {
  d: Snapshot;
  onSaved: (message: string) => Promise<void>;
  edit: (r: Row) => void;
}) {
  const [period, setPeriod] = useState(d.asOf.slice(0, 7)),
    [half, setHalf] = useState<"1" | "2" | "all">("all"),
    [tab, setTab] = useState("fixed"),
    [form, setForm] = useState<Form | null>(null);
  const b = budgetFor(d, period, half);
  const configs = fixedExpensesAt(d.fixedExpenses, period);
  const entries = d.cash.filter(
    (r) =>
      r.date.slice(0, 7) === period &&
      (half === "all" ||
        (Number(r.date.slice(8)) <= 15 ? "1" : "2") === half) &&
      ["EXPENSE", "SAVING", "SAVINGS_OPENING"].includes(r.kind),
  );
  const shown = entries.filter((r) =>
    tab === "fixed"
      ? r.fixed_expense_id
      : tab === "personal"
        ? !r.fixed_expense_id && r.funding !== "SAVINGS" && r.kind === "EXPENSE"
        : r.funding === "SAVINGS" ||
          ["SAVING", "SAVINGS_OPENING"].includes(r.kind) ||
          r.category === "SAVINGS",
  );
  return (
    <>
      <div className="expense-toolbar">
        <label className="inline-label">
          Mes
          <input
            type="month"
            value={period}
            onChange={(e) => {
              if (e.target.value) setPeriod(e.target.value);
            }}
          />
        </label>
        <div className="tabs">
          {(["1", "2", "all"] as const).map((h) => (
            <button
              key={h}
              className={half === h ? "active" : ""}
              onClick={() => setHalf(h)}
            >
              {h === "all"
                ? "Mes completo"
                : h === "1"
                  ? "1.ª quincena"
                  : "2.ª quincena"}
            </button>
          ))}
        </div>
        <button
          className="button primary"
          onClick={() => setForm({ type: "expense" })}
        >
          <Plus size={16} />
          Registrar gasto
        </button>
      </div>
      <FundTotals d={d} onSaved={onSaved} />
      <BudgetCategories b={b} />
      <div className="expense-summary section-gap">
        <section className="panel">
          <small>Caja real del período</small>
          <h2>{usd(b.actualCash)}</h2>
          <p className="fine-print">
            Ingresos y aportes recibidos, menos gastos de caja, ahorro separado
            y extras BG.
          </p>
        </section>
        <section className="panel">
          <small>Ahorro acumulado registrado</small>
          <h2 className={b.savingsBalance < 0 ? "expense-negative" : ""}>
            {usd(b.savingsBalance)}
          </h2>
          <p className="fine-print">
            Saldo al cierre del período seleccionado: {usd(b.savingsBefore)}{" "}
            previo + {usd(b.savingsOpening)} saldo incorporado + {usd(b.saving)}{" "}
            ahorrado + {usd(b.savingsAdjustment)} ajustes −{" "}
            {usd(b.savingsSpent)} gastado/retirado.
          </p>
          <button
            className="text-button"
            onClick={() => setForm({ type: "saving" })}
          >
            <Plus size={16} />
            Registrar ahorro o saldo previo
          </button>
        </section>
      </div>
      {b.savingsBalance < 0 && (
        <p className="warning" role="status">
          <Info size={17} />
          Las salidas superan el ahorro registrado. Registra el saldo previo que
          tenías o revisa los movimientos.
        </p>
      )}
      <div className="tabs section-gap">
        {[
          ["fixed", "Gastos fijos"],
          ["personal", "Personal y variables"],
          ["savings", "Ahorro"],
        ].map(([id, name]) => (
          <button
            key={id}
            className={tab === id ? "active" : ""}
            onClick={() => setTab(id)}
          >
            {name}
          </button>
        ))}
      </div>
      {tab === "fixed" && (
        <section className="panel section-gap">
          <div className="panel-heading">
            <div>
              <h2>Tus gastos fijos</h2>
              <p className="fine-print">
                Se repiten cada mes desde su vigencia. Puedes registrar pagos
                parciales.
              </p>
            </div>
            <button
              className="button secondary"
              onClick={() => setForm({ type: "fixed" })}
            >
              <Plus size={16} />
              Definir gasto fijo
            </button>
          </div>
          {!b.fixed.length ? (
            <p className="empty-inline">
              Aún no tienes gastos fijos en este período. Define alquiler,
              servicios u otros compromisos mensuales.
            </p>
          ) : (
            <div className="expense-fixed-list">
              {b.fixed.map((item) => (
                <article className="expense-fixed" key={item.fixed_id}>
                  <div>
                    <h3>{item.name}</h3>
                    <small>Vence {displayDate(item.dueDate)}</small>
                    <span
                      className={`status-badge ${!item.pending ? "success" : ""}`}
                    >
                      {!item.pending
                        ? "Pagado"
                        : item.paid
                          ? "Pago parcial"
                          : item.dueDate < d.asOf
                            ? "Vencido sin completar"
                            : "Pendiente"}
                    </span>
                  </div>
                  <div>
                    <small>Presupuestado</small>
                    <strong>{usd(item.planned)}</strong>
                  </div>
                  <div>
                    <small>Pagado</small>
                    <strong>{usd(item.paid)}</strong>
                  </div>
                  <div>
                    <small>Pendiente</small>
                    <strong>{usd(item.pending)}</strong>
                  </div>
                  <div className="expense-fixed-actions">
                    <button
                      className="text-button"
                      aria-label={`Editar ${item.name}`}
                      onClick={() => setForm({ type: "fixed", item })}
                    >
                      <Pencil size={16} />
                      Editar
                    </button>
                    {item.active && (
                      <button
                        className="button secondary"
                        onClick={() => setForm({ type: "expense", item })}
                      >
                        {item.pending ? "Registrar pago" : "Añadir pago"}
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
          {configs
            .filter((r) => !r.active)
            .map((r) => (
              <div className="composition-line" key={r.fixed_id}>
                <span>
                  {r.name} · Inactivo desde {r.effective_period}
                </span>
                <button
                  className="text-button"
                  onClick={() => setForm({ type: "fixed", item: r })}
                >
                  Editar vigencia
                </button>
              </div>
            ))}
        </section>
      )}
      <section className="panel section-gap">
        <div className="panel-heading">
          <h2>
            {tab === "fixed"
              ? "Pagos de gastos fijos"
              : tab === "personal"
                ? "Gastos personales y variables"
                : "Movimientos de ahorro"}
          </h2>
          <a className="text-button" href="/api/export?kind=budget">
            <Download size={16} />
            CSV
          </a>
        </div>
        {!shown.length ? (
          <p className="empty-inline">No hay registros en este período.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Concepto</th>
                  <th>Categoría / origen</th>
                  <th>Importe</th>
                  <th>Estado</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {displayDate(r.date)}
                      <small>Mes asignado: {r.period}</small>
                    </td>
                    <td>
                      {r.concept}
                      <small>{typeNames[r.kind]}</small>
                    </td>
                    <td>
                      {
                        {
                          NEEDS: "Necesidades",
                          WANTS: "Personal",
                          SAVINGS: "Ahorro",
                          DEBT: "Deuda",
                          OTHER: "Otros",
                        }[r.category as "NEEDS"]
                      }
                      <small>
                        {r.kind === "SAVINGS_OPENING"
                          ? "Saldo previo, fuera de caja"
                          : r.funding === "SAVINGS"
                            ? "Desde ahorro acumulado"
                            : "Desde caja personal"}
                      </small>
                    </td>
                    <td>{usd(cents(r.amount))}</td>
                    <td>{r.status === "active" ? "Registrado" : "Anulado"}</td>
                    <td>
                      {r.status === "active" && (
                        <button className="text-button" onClick={() => edit(r)}>
                          Corregir / anular
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="fine-print">
          Los registros se comparten con Mi presupuesto y Movimientos. No
          vuelvas a ingresarlos allí. Un gasto no reduce el capital del
          préstamo.
        </p>
      </section>
      {form && (
        <ExpenseForm
          form={form}
          period={period}
          d={d}
          close={() => setForm(null)}
          saved={async (message) => {
            await onSaved(message);
            setForm(null);
          }}
        />
      )}
    </>
  );
}
function ExpenseForm({
  form,
  period,
  d,
  close,
  saved,
}: {
  form: Form;
  period: string;
  d: Snapshot;
  close: () => void;
  saved: (message: string) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    key = useRef(crypto.randomUUID());
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [category, setCategory] = useState(
      form.item ? "NEEDS" : form.type === "saving" ? "SAVINGS" : "WANTS",
    ),
    [funding, setFunding] = useState("CASH"),
    [kind, setKind] = useState("SAVING"),
    [date, setDate] = useState(d.asOf),
    [amount, setAmount] = useState(
      form.type === "fixed"
        ? form.item?.amount || ""
        : form.item
          ? String(form.item.pending / 100)
          : "",
    ),
    [paymentPeriod, setPaymentPeriod] = useState(period);
  useEffect(() => {
    dialog.current?.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);
  const b = budgetFor(
    d,
    date.slice(0, 7),
    Number(date.slice(8)) <= 15 ? "1" : "2",
  );
  const monthly = budgetFor(d, date.slice(0, 7), "all");
  const c = b.categories.find((c) => c.id === category);
  const entered = /^\d{1,8}(\.\d{1,2})?$/.test(amount) ? cents(amount) : 0;
  const prospective =
    funding === "SAVINGS"
      ? monthly.savingsBalance - entered
      : (c?.remaining || 0) -
        entered +
        (form.item &&
        form.type === "expense" &&
        paymentPeriod === date.slice(0, 7)
          ? b.fixed.find((r) => r.fixed_id === form.item?.fixed_id)?.pending ||
            0
          : 0);
  const title =
    form.type === "fixed"
      ? form.item
        ? "Editar gasto fijo"
        : "Definir gasto fijo"
      : form.type === "saving"
        ? "Registrar ahorro"
        : "Registrar pago o gasto";
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget),
      s = (name: string) => String(f.get(name) || "");
    try {
      const body =
        form.type === "fixed"
          ? {
              requestKey: key.current,
              ...(form.item
                ? { id: form.item.fixed_id, revision: form.item.revision }
                : {}),
              effectivePeriod: s("effectivePeriod"),
              name: s("name"),
              amount,
              dueDay: Number(s("dueDay")),
              active: f.get("active") === "on",
            }
          : {
              requestKey: key.current,
              date,
              period: form.item ? paymentPeriod : date.slice(0, 7),
              kind: form.type === "saving" ? kind : "EXPENSE",
              category: form.type === "saving" ? "SAVINGS" : category,
              amount,
              concept: s("concept"),
              funding: form.type === "saving" ? "CASH" : funding,
              fixedExpenseId:
                form.type === "expense" ? form.item?.fixed_id || null : null,
            };
      const response = await fetch(
        form.type === "fixed" ? "/api/fixed-expense" : "/api/cash",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const j = await response.json();
      if (!response.ok) throw new Error(j.error);
      await saved(
        form.type === "fixed"
          ? "Gasto fijo guardado con su mes de vigencia."
          : "Movimiento guardado y presupuesto actualizado.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar.");
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="modal"
      aria-labelledby="expense-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) close();
      }}
    >
      <div className="modal-heading">
        <div>
          <span className="eyebrow">MIS GASTOS</span>
          <h2 id="expense-title">{title}</h2>
        </div>
        <button
          type="button"
          aria-label="Cerrar gasto"
          disabled={busy}
          onClick={close}
        >
          <X size={22} />
        </button>
      </div>
      <form onSubmit={submit}>
        <div className="modal-body">
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {form.type === "fixed" ? (
            <>
              <label>
                Nombre del gasto
                <input
                  name="name"
                  required
                  maxLength={200}
                  placeholder="Ej. Alquiler, internet…"
                  defaultValue={form.item?.name || ""}
                />
              </label>
              <div className="form-grid">
                <label>
                  Vigente desde el mes
                  <input
                    name="effectivePeriod"
                    type="month"
                    required
                    defaultValue={period}
                  />
                </label>
                <label>
                  Día de vencimiento
                  <input
                    name="dueDay"
                    type="number"
                    min="1"
                    max="31"
                    required
                    defaultValue={form.item?.due_day || 15}
                  />
                </label>
              </div>
              <label className="check-label">
                <input
                  name="active"
                  type="checkbox"
                  defaultChecked={form.item?.active ?? true}
                />
                Activo desde ese mes
              </label>
              <p className="fine-print">
                Se reserva en Necesidades (50%). En meses cortos vence el último
                día del mes. Cambios con una nueva vigencia conservan la
                configuración de meses anteriores; desactívalo desde el mes en
                que deje de aplicar.
              </p>
            </>
          ) : (
            <>
              <div className="form-grid">
                <label>
                  Fecha del movimiento
                  <input
                    type="date"
                    required
                    value={date}
                    max={d.asOf}
                    onChange={(e) => {
                      if (e.target.value) setDate(e.target.value);
                    }}
                  />
                </label>
                {form.item ? (
                  <label>
                    Mes del gasto fijo
                    <input
                      type="month"
                      required
                      value={paymentPeriod}
                      onChange={(e) => {
                        if (e.target.value) setPaymentPeriod(e.target.value);
                      }}
                    />
                  </label>
                ) : form.type === "expense" ? (
                  <label>
                    Parte del presupuesto
                    <select
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                    >
                      <option value="WANTS">Personal (30%)</option>
                      <option value="NEEDS">Necesidades (50%)</option>
                      <option value="SAVINGS">
                        Ahorro del mes (20%, menos deuda)
                      </option>
                    </select>
                  </label>
                ) : (
                  <label>
                    Tipo de ahorro
                    <select
                      value={kind}
                      onChange={(e) => setKind(e.target.value)}
                    >
                      <option value="SAVING">
                        Apartar dinero de caja a ahorro
                      </option>
                      <option value="SAVINGS_OPENING">
                        Incorporar saldo previo de ahorro
                      </option>
                    </select>
                  </label>
                )}
              </div>
              {form.type === "expense" && (
                <label>
                  Origen del dinero
                  <select
                    value={funding}
                    onChange={(e) => setFunding(e.target.value)}
                  >
                    <option value="CASH">Caja personal de este mes</option>
                    <option value="SAVINGS">Ahorros acumulados</option>
                  </select>
                </label>
              )}
              <label>
                Concepto
                <input
                  name="concept"
                  required
                  maxLength={200}
                  defaultValue={
                    form.item?.name || (form.type === "saving" ? "Ahorro" : "")
                  }
                  placeholder="Ej. Supermercado, salida, emergencia…"
                />
              </label>
            </>
          )}
          <label>
            Importe (USD)
            <input
              type="number"
              required
              step="0.01"
              min="0.01"
              max="99999999.99"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
          {form.type === "expense" && (
            <p className={prospective < 0 ? "warning" : "notice"} role="status">
              <Info size={17} />
              {funding === "SAVINGS"
                ? `Ahorro registrado después del gasto: ${usd(prospective)}. No se descuenta otra vez de caja ni de la asignación mensual.`
                : `Disponible en esta quincena después de registrar: ${usd(prospective)}. Los fijos ya reservados se liberan al pagarlos.`}
              {prospective < 0
                ? " El registro se permite con alerta para reflejar el pago real."
                : ""}
            </p>
          )}
          {form.type === "saving" && kind === "SAVING" && (
            <p className={prospective < 0 ? "warning" : "notice"} role="status">
              Disponible en ahorro/deuda de esta quincena después de apartar:{" "}
              {usd(prospective)}.
              {prospective < 0
                ? " Supera el presupuesto; se permite registrar el movimiento real."
                : ""}
            </p>
          )}
          {form.type === "saving" && (
            <p className="notice">
              <Info size={17} />
              {kind === "SAVING"
                ? "Apartar ahorro consume tu presupuesto de ahorro/deuda y sale de caja. Cuando lo gastes desde ahorros acumulados, se descontará solo del ahorro."
                : "Registra únicamente ahorro que ya tenías fuera de caja y que aún no has ingresado. No crea salario ni consume el presupuesto de este mes."}
            </p>
          )}
        </div>
        <div className="modal-footer">
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={close}
          >
            Cancelar
          </button>
          <button className="button primary" disabled={busy}>
            {busy
              ? "Guardando…"
              : form.type === "fixed"
                ? "Guardar gasto fijo"
                : "Guardar movimiento"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
