"use client";
import { useRef, useState } from "react";
import { type Snapshot, usd, displayDate } from "./dashboard";
export default function CashCompensations({
  d,
  onSaved,
}: {
  d: Snapshot;
  onSaved: () => Promise<void>;
}) {
  const key = useRef<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [edit, setEdit] = useState<string | null>(null);
  const allowed = d.totals.capital === 0 && d.totals.pending === 0;
  const selected = d.cashCompensations.find((x) => x.id === edit);
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      key.current ||= crypto.randomUUID();
      const body = selected
        ? {
            revision: selected.revision,
            action: f.get("action"),
            amount: f.get("amount"),
            reason: f.get("reason"),
          }
        : {
            requestKey: key.current,
            receiptId: f.get("receiptId"),
            amount: f.get("amount"),
            reason: f.get("reason"),
          };
      const r = await fetch(
          "/api/cash-compensation" + (selected ? "/" + selected.id : ""),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
        ),
        j = await r.json();
      if (!r.ok) throw new Error(j.error);
      await onSaved();
      setEdit(null);
      key.current = null;
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar.");
    } finally {
      setBusy(false);
    }
  }
  if (!allowed && !d.cashCompensations.length) return null;
  return (
    <section className="panel section-gap">
      <div className="panel-heading">
        <h2>Reembolso al cancelar el préstamo</h2>
        <a className="text-button" href="/api/export?kind=cash-compensations">
          CSV
        </a>
      </div>
      <p className="fine-print">
        Cuando BG queda saldado, aplica un aporte CrediJamar recibido a los
        cargos que Javier adelantó. El aporte ya cuenta en caja: esta aplicación
        no registra otro ingreso ni un pago al banco. Pendiente:{" "}
        {usd(d.real.advance)}.
      </p>
      {(selected || (allowed && d.real.advance > 0)) && (
        <form onSubmit={save} className="settings-form" key={edit || "create"}>
          <div className="form-grid">
            {selected ? (
              <label>
                Acción sobre el reembolso
                <select name="action" defaultValue="correct">
                  <option value="correct">Corregir importe</option>
                  <option value="void">Anular aplicación</option>
                </select>
              </label>
            ) : (
              <label>
                Aporte CrediJamar recibido
                <select name="receiptId" required defaultValue="">
                  <option value="" disabled>
                    Selecciona un aporte
                  </option>
                  {d.contributions
                    .filter(
                      (x) => x.status === "active" && x.source_id === "credi",
                    )
                    .map((x) => (
                      <option key={x.id} value={x.id}>
                        {displayDate(x.date)} · {x.contributor} ·{" "}
                        {usd(Math.round(Number(x.amount) * 100))}
                      </option>
                    ))}
                </select>
              </label>
            )}
            <label>
              Reembolso aplicado (USD)
              <input
                name="amount"
                inputMode="decimal"
                pattern="[0-9]+([.][0-9]{1,2})?"
                required
                defaultValue={
                  selected?.amount || (d.real.advance / 100).toFixed(2)
                }
              />
            </label>
            <label className="full">
              Motivo del reembolso
              <input name="reason" required minLength={5} maxLength={500} />
            </label>
          </div>
          <div className="form-footer">
            <button className="button primary" disabled={busy}>
              {busy
                ? "Guardando…"
                : selected
                  ? "Guardar cambio del reembolso"
                  : "Aplicar reembolso recibido"}
            </button>
            {selected && (
              <button
                type="button"
                className="text-button"
                onClick={() => setEdit(null)}
              >
                Cancelar edición
              </button>
            )}
          </div>
        </form>
      )}
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      {d.cashCompensations.length > 0 && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Fecha / persona</th>
                <th>Recibido aplicado</th>
                <th>Compensado</th>
                <th>Exceso</th>
                <th>Estado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {d.cashCompensations.map((x) => {
                const a = d.real.cashCompensations?.find((a) => a.id === x.id);
                return (
                  <tr key={x.id}>
                    <td>
                      {displayDate(x.date)}
                      <small>{x.contributor}</small>
                    </td>
                    <td>{usd(Math.round(Number(x.amount) * 100))}</td>
                    <td>{usd(a?.applied || 0)}</td>
                    <td>{usd(a?.excess || 0)}</td>
                    <td>{x.status === "active" ? "Real" : "Anulado"}</td>
                    <td>
                      {x.status === "active" && (
                        <button
                          className="text-button"
                          onClick={() => {
                            setEdit(x.id);
                            setError("");
                          }}
                        >
                          Revisar reembolso
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
