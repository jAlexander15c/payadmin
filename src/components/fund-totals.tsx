"use client";
import { useEffect, useRef, useState } from "react";
import { Plus, Minus, Pencil, X, Download } from "lucide-react";
import { cents } from "@/lib/finance";
import { fundEffect, fundEffectNames, type FundEffect } from "@/lib/funds";
import { type Snapshot, usd, displayDate } from "./dashboard";
type Wallet = Snapshot["funds"][number];
type Operation = "SET" | "ADD" | "REMOVE";
const operationNames = { SET: "Editar total", ADD: "Agregar", REMOVE: "Sacar" };
export default function FundTotals({
  d,
  onSaved,
}: {
  d: Snapshot;
  onSaved: (message: string) => Promise<void>;
}) {
  const [form, setForm] = useState<{
    wallet: Wallet;
    operation: Operation;
  } | null>(null);
  return (
    <section className="panel section-gap fund-totals">
      <div className="panel-heading">
        <div>
          <h2>Mis totales</h2>
          <p className="fine-print">
            Saldos actuales al {displayDate(d.asOf)}. Se conservan de un mes a
            otro.
          </p>
        </div>
      </div>
      <div className="expense-budget-grid">
        {d.funds.map((wallet, i) => (
          <article
            className="expense-budget"
            key={wallet.id}
            data-fund={wallet.id}
          >
            <span className={`dot ${["chunky", "credi", "cards"][i]}`} />
            <h3>{wallet.name}</h3>
            <strong className={wallet.balance < 0 ? "expense-negative" : ""}>
              {wallet.configured ? usd(wallet.balance) : "Por configurar"}
            </strong>
            <small>
              {wallet.configured
                ? "Total disponible registrado"
                : `Movimiento neto registrado: ${usd(wallet.balance)}`}
            </small>
            <div className="fund-actions">
              <button
                className="button secondary"
                onClick={() => setForm({ wallet, operation: "SET" })}
              >
                <Pencil size={14} />
                Editar total
              </button>
              <button
                className="button secondary"
                onClick={() => setForm({ wallet, operation: "ADD" })}
              >
                <Plus size={14} />
                Agregar
              </button>
              <button
                className="button secondary"
                onClick={() => setForm({ wallet, operation: "REMOVE" })}
              >
                <Minus size={14} />
                Sacar
              </button>
            </div>
          </article>
        ))}
      </div>
      <p className="fine-print">
        Puedes empezar aunque la quincena ya haya comenzado: usa «Editar total»
        para indicar lo que te queda hoy, sin registrar los gastos anteriores.
        Los gastos de Fijo descuentan Fijo; los personales descuentan Personal;
        los pagados desde ahorros acumulados descuentan Ahorro. «Agregar»
        permite ingresos extra o dinero que ya tenías; «Sacar» permite una
        salida nueva o un ajuste de saldo. Ingresa cada salida una sola vez,
        aquí o en Registrar gasto/pago.
      </p>
      <details className="fund-history">
        <summary>
          Historial de cambios de totales ({d.fundAdjustments.length})
        </summary>
        <a className="text-button" href="/api/export?kind=funds">
          <Download size={15} />
          Exportar cambios
        </a>
        {!d.fundAdjustments.length ? (
          <p className="empty-inline">Todavía no has ajustado tus totales.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Apartado</th>
                  <th>Operación</th>
                  <th>Tipo de movimiento</th>
                  <th>Importe</th>
                  <th>Cambio</th>
                  <th>Antes → después</th>
                  <th>Motivo</th>
                </tr>
              </thead>
              <tbody>
                {d.fundAdjustments.slice(0, 50).map((r) => (
                  <tr key={r.id}>
                    <td>{displayDate(r.date)}</td>
                    <td>
                      {
                        { NEEDS: "Fijo", WANTS: "Personal", SAVINGS: "Ahorro" }[
                          r.bucket as Wallet["id"]
                        ]
                      }
                    </td>
                    <td>{operationNames[r.operation as Operation]}</td>
                    <td>{fundEffectNames[fundEffect(r)]}</td>
                    <td>{usd(cents(r.amount))}</td>
                    <td>{usd(cents(r.delta))}</td>
                    <td>
                      {usd(cents(r.before_balance))} →{" "}
                      {usd(cents(r.after_balance))}
                    </td>
                    <td>{r.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </details>
      {form && (
        <FundForm
          {...form}
          close={() => setForm(null)}
          saved={async () => {
            await onSaved(
              "Total actualizado y cambio guardado en el historial.",
            );
            setForm(null);
          }}
          refresh={async () => {
            await onSaved("Saldos actualizados. Vuelve a abrir Editar total.");
            setForm(null);
          }}
        />
      )}
    </section>
  );
}
function FundForm({
  wallet,
  operation,
  close,
  saved,
  refresh,
}: {
  wallet: Wallet;
  operation: Operation;
  close: () => void;
  saved: () => Promise<void>;
  refresh: () => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    key = useRef(crypto.randomUUID());
  const [amount, setAmount] = useState(
      operation === "SET" && wallet.configured && wallet.balance >= 0
        ? (wallet.balance / 100).toFixed(2)
        : "",
    ),
    [busy, setBusy] = useState(false),
    [effect, setEffect] = useState<FundEffect>(
      operation === "ADD"
        ? "INCOME"
        : operation === "REMOVE"
          ? "EXPENSE"
          : "ADJUSTMENT",
    ),
    [error, setError] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);
  const entered = /^\d{1,8}(\.\d{1,2})?$/.test(amount) ? cents(amount) : 0;
  const next =
    operation === "SET"
      ? entered
      : wallet.balance + (operation === "ADD" ? entered : -entered);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    try {
      const r = await fetch("/api/fund", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestKey: key.current,
          bucket: wallet.id,
          operation,
          effect,
          amount,
          expectedBalance: wallet.balance,
          reason: String(f.get("reason") || ""),
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      await saved();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "No se pudo actualizar el total.",
      );
      setBusy(false);
    }
  }
  return (
    <dialog
      className="modal"
      ref={dialog}
      aria-labelledby="fund-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) close();
      }}
    >
      <div className="modal-heading">
        <div>
          <span className="eyebrow">MIS TOTALES · {wallet.name}</span>
          <h2 id="fund-title">
            {operationNames[operation]} · {wallet.name}
          </h2>
        </div>
        <button
          aria-label="Cerrar ajuste"
          type="button"
          onClick={close}
          disabled={busy}
        >
          <X size={22} />
        </button>
      </div>
      <form onSubmit={submit}>
        <div className="modal-body">
          <p className="fine-print">
            Saldo calculado desde tus registros: {usd(wallet.balance)}.
          </p>
          {operation === "SET" && (
            <p className="notice">
              Pon el dinero que te queda ahora, aunque ya hayas gastado antes de
              usar la app. No necesitas reconstruir esos gastos.
            </p>
          )}
          {operation === "ADD" && (
            <label>
              ¿Qué dinero estás agregando?
              <select
                value={effect}
                onChange={(e) => setEffect(e.target.value as FundEffect)}
              >
                <option value="INCOME">Dinero extra que acaba de entrar</option>
                <option value="ALLOCATION">
                  Dinero que ya tenía o ya registré
                </option>
              </select>
            </label>
          )}
          {operation === "REMOVE" && (
            <label>
              ¿Qué quieres registrar?
              <select
                value={effect}
                onChange={(e) => setEffect(e.target.value as FundEffect)}
              >
                <option value="EXPENSE">Un gasto o salida nueva</option>
                <option value="ADJUSTMENT">
                  Solo ajustar saldo (gastos anteriores o corrección)
                </option>
              </select>
            </label>
          )}
          <label>
            {operation === "SET" ? "Nuevo total (USD)" : "Importe (USD)"}
            <input
              type="number"
              step="0.01"
              min={operation === "SET" ? "0" : "0.01"}
              max="99999999.99"
              inputMode="decimal"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
          <label>
            Concepto o motivo (opcional)
            <textarea
              name="reason"
              maxLength={500}
              rows={2}
              placeholder={
                operation === "SET"
                  ? "Ej. Total que tengo actualmente"
                  : "Ej. Fondos repartidos o salida de dinero"
              }
            />
          </label>
          <p className={next < 0 ? "warning" : "notice"} role="status">
            Total después del cambio: {usd(next)}.
            {next < 0
              ? " La salida supera el saldo registrado y quedará visible."
              : ""}
          </p>
          <p className="fine-print">
            {operation === "SET"
              ? "El saldo quedará en el total que indiques. No vuelve a cobrar gastos anteriores ni crea un ingreso."
              : operation === "ADD"
                ? effect === "INCOME"
                  ? wallet.id === "SAVINGS"
                    ? "Registra una entrada destinada a Ahorro. Suma a ese saldo y a las entradas de tu control de gastos. La referencia salarial se conserva."
                    : "Registra el ingreso una sola vez: suma al saldo y a las entradas de este apartado. Tú eliges dónde ponerlo; no cambia tu salario ni se reparte automáticamente."
                  : "Agrega dinero que ya tenías o cuyo ingreso ya registraste. Suma al saldo sin duplicar ingresos."
                : effect === "ADJUSTMENT"
                  ? "Solo reduce el saldo para reflejar lo que tienes ahora. No crea una salida nueva ni se cuenta como consumo."
                  : wallet.id === "SAVINGS"
                    ? "Descuenta el saldo de Ahorro y registra una salida en ese apartado. Si ya registraste este gasto, no lo saques de nuevo."
                    : "Esta salida descuenta el saldo y se cuenta como consumo del apartado. Para pagar un gasto fijo definido, usa Registrar pago; no ingreses la misma salida dos veces."}
          </p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {error.includes("saldo cambió") && (
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={refresh}
            >
              Actualizar saldos
            </button>
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
            {busy ? "Guardando…" : "Guardar cambio"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
