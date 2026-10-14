"use client";
import { useEffect, useRef, useState } from "react";
import { Check, Plus, X } from "lucide-react";
import { cents, money } from "@/lib/finance";
import {
  payrollExpected,
  suggestedAllocation,
  suggestedNextDue,
} from "@/lib/payroll";
import { FUND_BUCKETS, type FundBucket } from "@/lib/funds";
import { expenseBucketNames } from "@/lib/expenses";
import { type Snapshot, usd, displayDate, names } from "./dashboard";

type Row = Record<string, any>;
type Allocation = Record<FundBucket, string>;
type Form =
  | { kind: "salary" }
  | { kind: "receipt" | "void-salary" | "void-receipt"; record: Row };
const entered = (s: string) => (/^\d{1,8}(\.\d{1,2})?$/.test(s) ? cents(s) : 0);
const blank: Allocation = { NEEDS: "0.00", WANTS: "0.00", SAVINGS: "0.00" };
function pending(d: Snapshot, cycle: Row) {
  return (
    cents(cycle.chunky_expected) -
    d.payrollReceipts
      .filter((r) => r.status === "active" && r.payroll_id === cycle.id)
      .reduce((s, r) => s + cents(r.amount), 0)
  );
}
export default function PayrollPanel({
  d,
  onSaved,
}: {
  d: Snapshot;
  onSaved: (message: string) => Promise<void>;
}) {
  const [form, setForm] = useState<Form | null>(null);
  const half = Number(d.asOf.slice(8)) <= 15 ? "1" : "2";
  const expected = payrollExpected(d.versions, d.asOf.slice(0, 7), half);
  const cycles = d.payrollCycles.filter((r) => r.status === "active");
  const current = cycles.find(
    (r) => r.period === d.asOf.slice(0, 7) && String(r.half) === half,
  );
  return (
    <section className="panel section-gap payroll-panel" id="tu-quincena">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">SALARIO Y COBROS</span>
          <h2>Tu quincena</h2>
          <p className="fine-print">
            Confirma lo que recibiste y reparte el dinero entre Fijo, Personal y
            Ahorro.
          </p>
        </div>
        <button
          className="button primary"
          onClick={() => setForm({ kind: "salary" })}
        >
          <Plus size={16} />
          {current ? "Registrar otra quincena" : "Confirmar salario"}
        </button>
      </div>
      {!current && (
        <p className="notice">
          Salario neto esperado: <strong>{usd(expected.received)}</strong> ·
          deducción del préstamo: {usd(expected.deduction)}. Puedes indicar los
          importes reales al confirmar.
        </p>
      )}
      <p className="fine-print">
        La deducción se registra al confirmar el salario, aunque Chunky aún no
        te pague. Su reembolso se agrega cuando lo recibas y tú eliges el
        destino. CrediJamar conserva sus abonos voluntarios.
      </p>
      {cycles.length > 0 && (
        <div className="payroll-cycles">
          {cycles.map((cycle) => {
            const left = pending(d, cycle),
              receipts = d.payrollReceipts.filter(
                (r) => r.status === "active" && r.payroll_id === cycle.id,
              );
            const application = d.real.applications.find(
              (a) => a.id === cycle.bank_movement_id,
            );
            return (
              <article
                className="payroll-cycle"
                key={cycle.id}
                data-testid="payroll-cycle"
              >
                <div className="panel-heading">
                  <div>
                    <h3>
                      {cycle.half}.ª quincena · {cycle.period}
                    </h3>
                    <small>Recibida el {displayDate(cycle.date)}</small>
                  </div>
                  <span className="status-badge success">
                    <Check size={14} /> Salario confirmado
                  </span>
                </div>
                <div className="payroll-summary">
                  <div>
                    <small>Salario neto recibido</small>
                    <strong>{usd(cents(cycle.received_amount))}</strong>
                  </div>
                  <div>
                    <small>Deducción registrada</small>
                    <strong>{usd(cents(cycle.deduction_amount))}</strong>
                  </div>
                  <div>
                    <small>Próximo vencimiento mensual</small>
                    <strong>{displayDate(cycle.next_due)}</strong>
                  </div>
                </div>
                <p className="fine-print">
                  Repartido:{" "}
                  {FUND_BUCKETS.map(
                    (b) =>
                      `${expenseBucketNames[b]} ${usd(cents(cycle.allocation[b]))}`,
                  ).join(" · ")}
                </p>
                <div className="payroll-receipt-line">
                  <div>
                    <strong>
                      Chunky · {left ? `${usd(left)} por cobrar` : "Cobrado"}
                    </strong>
                    <small>
                      Esperado por esta quincena:{" "}
                      {usd(cents(cycle.chunky_expected))} · recibido:{" "}
                      {usd(cents(cycle.chunky_expected) - left)}
                    </small>
                  </div>
                  {left > 0 && (
                    <button
                      className="button secondary"
                      onClick={() =>
                        setForm({ kind: "receipt", record: cycle })
                      }
                    >
                      Recibí pago de Chunky
                    </button>
                  )}
                </div>
                <details className="fund-history">
                  <summary>Ver detalle y corregir</summary>
                  {application && (
                    <>
                      <p className="fine-print">
                        Aplicación de la deducción según el préstamo. El capital
                        de tarjetas queda incluido aquí.
                      </p>
                      <div className="table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>Sección</th>
                              <th>Capital</th>
                              <th>Interés</th>
                              <th>FECI</th>
                              <th>Otros</th>
                            </tr>
                          </thead>
                          <tbody>
                            {application.allocations.map((a) => (
                              <tr key={a.source}>
                                <td>{names[a.source]}</td>
                                <td>{usd(a.principal)}</td>
                                <td>{usd(a.interest)}</td>
                                <td>{usd(a.feci)}</td>
                                <td>{usd(a.other)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                  {receipts.map((r) => (
                    <div className="payroll-receipt-line" key={r.id}>
                      <div>
                        <strong>
                          Cobro de Chunky · {usd(cents(r.amount))}
                        </strong>
                        <small>
                          {displayDate(r.date)} ·{" "}
                          {FUND_BUCKETS.filter(
                            (b) => cents(r.allocation[b]) > 0,
                          )
                            .map(
                              (b) =>
                                `${expenseBucketNames[b]} ${usd(cents(r.allocation[b]))}`,
                            )
                            .join(" · ")}
                        </small>
                      </div>
                      <button
                        className="text-button"
                        onClick={() =>
                          setForm({ kind: "void-receipt", record: r })
                        }
                      >
                        Anular cobro
                      </button>
                    </div>
                  ))}
                  <p className="fine-print">
                    Para corregir un importe, anula el registro y vuelve a
                    confirmarlo.{" "}
                    {receipts.length > 0
                      ? "Anula primero los cobros vinculados."
                      : "Se retirarán juntos el salario, su reparto y la deducción creados con esta confirmación."}
                  </p>
                  <button
                    className="text-button"
                    disabled={receipts.length > 0}
                    onClick={() =>
                      setForm({ kind: "void-salary", record: cycle })
                    }
                  >
                    Anular quincena
                  </button>
                </details>
              </article>
            );
          })}
        </div>
      )}
      {form && (
        <PayrollForm
          d={d}
          form={form}
          close={() => setForm(null)}
          saved={async () => {
            await onSaved(
              form.kind === "salary"
                ? "Salario repartido y deducción registrada. Chunky queda pendiente de cobro."
                : form.kind === "receipt"
                  ? "Cobro de Chunky recibido y repartido en los apartados elegidos."
                  : "Registro anulado. Puedes volver a confirmarlo con los datos correctos.",
            );
            setForm(null);
          }}
        />
      )}
    </section>
  );
}
function AllocationFields({
  allocation,
  change,
  total,
}: {
  allocation: Allocation;
  change: (v: Allocation) => void;
  total: number;
}) {
  const assigned = FUND_BUCKETS.reduce((s, b) => s + entered(allocation[b]), 0);
  return (
    <fieldset className="payroll-allocation">
      <legend>Destino del dinero recibido</legend>
      <div className="payroll-summary">
        {FUND_BUCKETS.map((b) => (
          <label key={b}>
            {expenseBucketNames[b]} (USD)
            <input
              type="number"
              min="0"
              max="99999999.99"
              step="0.01"
              inputMode="decimal"
              required
              value={allocation[b]}
              onChange={(e) => change({ ...allocation, [b]: e.target.value })}
            />
          </label>
        ))}
      </div>
      <p
        className={assigned === total ? "fine-print" : "warning"}
        role="status"
      >
        Por repartir: {usd(total - assigned)} · asignado: {usd(assigned)}
      </p>
    </fieldset>
  );
}
function PayrollForm({
  d,
  form,
  close,
  saved,
}: {
  d: Snapshot;
  form: Form;
  close: () => void;
  saved: () => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    key = useRef(crypto.randomUUID());
  const isSalary = form.kind === "salary",
    isVoid = form.kind.startsWith("void");
  const initialHalf = Number(d.asOf.slice(8)) <= 15 ? "1" : "2";
  const initial = payrollExpected(d.versions, d.asOf.slice(0, 7), initialHalf);
  const [date, setDate] = useState(d.asOf),
    [half, setHalf] = useState<"1" | "2">(initialHalf);
  const [amount, setAmount] = useState(
    isSalary
      ? money(initial.received)
      : form.kind === "receipt"
        ? money(pending(d, form.record))
        : "0.00",
  );
  const [deduction, setDeduction] = useState(money(initial.deduction));
  const [nextDue, setNextDue] = useState(
    suggestedNextDue(d.versions, d.asOf, d.payrollCycles),
  );
  const [allocation, setAllocation] = useState<Allocation>(
    isSalary ? initial.allocation : { ...blank },
  );
  const [destination, setDestination] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);
  const total = entered(amount),
    assigned = FUND_BUCKETS.reduce((s, b) => s + entered(allocation[b]), 0);
  const expected = payrollExpected(
    d.versions,
    date.slice(0, 7) || d.asOf.slice(0, 7),
    half,
  );
  const title = isSalary
    ? "Confirmar salario recibido"
    : form.kind === "receipt"
      ? "Registrar pago de Chunky"
      : form.kind === "void-salary"
        ? "Anular quincena"
        : "Anular cobro de Chunky";
  function useExpected() {
    setAmount(money(expected.received));
    setDeduction(money(expected.deduction));
    setAllocation(expected.allocation);
  }
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const f = new FormData(e.currentTarget);
    const url = isSalary
      ? "/api/payroll"
      : form.kind === "receipt"
        ? "/api/payroll-receipt"
        : `/api/${form.kind === "void-salary" ? "payroll" : "payroll-receipt"}/${form.record.id}/void`;
    const body = isVoid
      ? { reason: String(f.get("reason") || "") }
      : isSalary
        ? {
            requestKey: key.current,
            date,
            period: date.slice(0, 7),
            half,
            received: amount,
            deduction,
            nextDue,
            allocation,
          }
        : {
            requestKey: key.current,
            payrollId: form.kind === "receipt" ? form.record.id : "",
            date,
            amount,
            allocation,
          };
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      await saved();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "No se pudo guardar el registro.",
      );
      setBusy(false);
    }
  }
  return (
    <dialog
      className="modal"
      ref={dialog}
      aria-labelledby="payroll-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) close();
      }}
    >
      <div className="modal-heading">
        <div>
          <span className="eyebrow">TU QUINCENA</span>
          <h2 id="payroll-title">{title}</h2>
        </div>
        <button aria-label="Cerrar quincena" disabled={busy} onClick={close}>
          <X size={22} />
        </button>
      </div>
      <form onSubmit={submit}>
        <div className="modal-body">
          {isVoid ? (
            <>
              <p className="notice">
                {form.kind === "void-salary"
                  ? "Se anularán el salario, su reparto y la deducción creados con esta confirmación. Los movimientos manuales previos que se hayan reutilizado se conservan."
                  : "Se anularán este cobro de Chunky y su reparto. La deducción bancaria se conserva y el importe vuelve a quedar pendiente de cobro."}
              </p>
              <label>
                Motivo
                <textarea
                  name="reason"
                  required
                  minLength={5}
                  maxLength={500}
                  rows={2}
                />
              </label>
            </>
          ) : (
            <>
              <label>
                Fecha de recepción
                <input
                  type="date"
                  required
                  max={d.asOf}
                  min={form.kind === "receipt" ? form.record.date : undefined}
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </label>
              {isSalary && (
                <>
                  <label>
                    Quincena
                    <select
                      value={half}
                      onChange={(e) => setHalf(e.target.value as "1" | "2")}
                    >
                      <option value="1">Primera quincena</option>
                      <option value="2">Segunda quincena</option>
                    </select>
                  </label>
                  <p className="fine-print">
                    Esperado para esta quincena: {usd(expected.received)} netos,
                    después de {usd(expected.deduction)} de deducción.
                  </p>
                  <button
                    type="button"
                    className="text-button"
                    onClick={useExpected}
                  >
                    Usar salario y deducción esperados
                  </button>
                </>
              )}
              {form.kind === "receipt" && (
                <p className="notice">
                  Pendiente de la quincena {form.record.half} de{" "}
                  {form.record.period}: {usd(pending(d, form.record))}. Puedes
                  registrar un cobro parcial. La deducción del préstamo ya está
                  registrada.
                </p>
              )}
              <label>
                {isSalary
                  ? "Salario neto recibido (USD)"
                  : "Importe recibido de Chunky (USD)"}
                <input
                  type="number"
                  required
                  min="0.01"
                  max={
                    form.kind === "receipt"
                      ? money(pending(d, form.record))
                      : "99999999.99"
                  }
                  step="0.01"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => {
                    setAmount(e.target.value);
                    if (isSalary)
                      setAllocation(
                        suggestedAllocation(entered(e.target.value)),
                      );
                    else if (destination && destination !== "custom")
                      setAllocation({
                        ...blank,
                        [destination]: e.target.value,
                      });
                  }}
                />
              </label>
              {isSalary ? (
                <>
                  <p className="fine-print">
                    Es el dinero que llegó a tu cuenta. La deducción ya está
                    descontada de este importe.
                  </p>
                  <label>
                    Deducción del préstamo en esta quincena (USD)
                    <input
                      type="number"
                      min="0"
                      max="99999999.99"
                      step="0.01"
                      inputMode="decimal"
                      required
                      value={deduction}
                      onChange={(e) => setDeduction(e.target.value)}
                    />
                  </label>
                  <label>
                    Próximo vencimiento mensual del préstamo
                    <input
                      type="date"
                      required
                      min={date}
                      value={nextDue}
                      onChange={(e) => setNextDue(e.target.value)}
                    />
                  </label>
                  <p className="fine-print">
                    El vencimiento puede ser el 16 de noviembre; la deducción de
                    esta quincena se guarda con la fecha en que recibiste el
                    salario.
                  </p>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setAllocation(suggestedAllocation(total))}
                  >
                    Sugerir reparto 50% fijo · 30% personal · 20% ahorro
                  </button>
                </>
              ) : (
                <label>
                  ¿Dónde quieres poner este dinero?
                  <select
                    required
                    value={destination}
                    onChange={(e) => {
                      setDestination(e.target.value);
                      setAllocation(
                        e.target.value === "custom"
                          ? { ...blank }
                          : { ...blank, [e.target.value]: amount },
                      );
                    }}
                  >
                    <option value="">Elige un destino</option>
                    {FUND_BUCKETS.map((b) => (
                      <option key={b} value={b}>
                        Todo a {expenseBucketNames[b]}
                      </option>
                    ))}
                    <option value="custom">
                      Repartir entre varios apartados
                    </option>
                  </select>
                </label>
              )}
              <AllocationFields
                allocation={allocation}
                total={total}
                change={(v) => {
                  setAllocation(v);
                  if (!isSalary) setDestination("custom");
                }}
              />
              <p className="fine-print">
                {isSalary
                  ? "Al confirmar, sumaremos este reparto a tus saldos y registraremos la deducción del préstamo con sus cálculos actuales, incluida la sección de tarjetas. Chunky queda por cobrar; CrediJamar se abona cuando tú lo registres."
                  : "Este cobro suma a los apartados elegidos. No vuelve a pagar el préstamo ni cambia tu salario de referencia."}
              </p>
            </>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
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
          <button
            className="button primary"
            disabled={busy || (!isVoid && (total <= 0 || assigned !== total))}
          >
            {busy
              ? "Guardando…"
              : isSalary
                ? "Confirmar y repartir"
                : form.kind === "receipt"
                  ? "Guardar cobro y reparto"
                  : "Confirmar anulación"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
