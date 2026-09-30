"use client";
import { useState } from "react";
import { Info, Plus, Save, Trash2 } from "lucide-react";
import { type Snapshot, displayDate } from "./dashboard";
export default function SettingsForm({
  d,
  onSaved,
}: {
  d: Snapshot;
  onSaved: () => Promise<void>;
}) {
  const p = d.parameters,
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [people, setPeople] = useState<{ name: string; percent: string }[]>([
      { name: "Javier", percent: "" },
      { name: "", percent: "" },
    ]);
  const hasHistory = d.movements.length > 0 || d.statements.length > 0;
  const next = (() => {
    const [y, m] = d.asOf.slice(0, 7).split("-").map(Number);
    return `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}`;
  })();
  async function post(path: string, body: unknown) {
    const r = await fetch("/api/" + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error);
  }
  async function save(
    e: React.FormEvent<HTMLFormElement>,
    responsibility = false,
  ) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget),
      s = (name: string) => String(f.get(name) || "");
    try {
      if (responsibility)
        await post("responsibilities", {
          effectivePeriod: s("effectivePeriod"),
          participants: people.filter((x) => x.name && x.percent !== ""),
          reason: s("reason"),
        });
      else
        await post("parameters", {
          effectivePeriod: s("effectivePeriod"),
          interest: s("interest"),
          feci: s("feci"),
          regular: s("regular"),
          chunky: s("chunky"),
          credi: s("credi"),
          firstDue: s("firstDue"),
          provisional: f.get("provisional") === "on",
          salary: s("salary"),
          salaryIncludesLoan: f.get("salaryIncludesLoan") === "on",
          reason: s("reason"),
        });
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar.");
    } finally {
      setBusy(false);
    }
  }
  async function confirmDate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      await post("first-date", {
        date: String(f.get("date")),
        reason: String(f.get("reason")),
      });
      await onSaved();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "No se pudo confirmar la fecha.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="notice">
        <Info size={17} />
        Los cambios de tasa, cuota o responsabilidades tienen vigencia. Después
        de registrar pagos o extractos se aplican a períodos futuros sin
        reescribir la historia. La cuota Chunky inicial es fija; solo cambia por
        una decisión explícita registrada aquí.
      </div>
      <section className="panel section-gap">
        <div className="panel-heading">
          <h2>Confirmar el primer vencimiento</h2>
          <span className="tag">
            {p.provisional ? "Fecha pendiente" : "Fecha confirmada"}
          </span>
        </div>
        <p className="fine-print">
          Puedes sustituir el día provisional por el confirmado, incluso después
          de registrar pagos. Se conserva el mes de inicio y se audita el
          cambio. Las fechas reales de pagos, tasas y cuotas históricas se
          conservan.
        </p>
        <form className="settings-form" onSubmit={confirmDate}>
          <div className="form-grid">
            <label>
              Día confirmado del primer vencimiento
              <input
                type="date"
                name="date"
                defaultValue={d.versions[0].firstDue}
                required
              />
            </label>
            <label>
              Información que lo confirma
              <input
                name="reason"
                minLength={5}
                maxLength={500}
                required
                placeholder="Extracto o confirmación del banco"
              />
            </label>
          </div>
          <button className="button primary" disabled={busy}>
            <Save size={17} />
            Confirmar fecha con auditoría
          </button>
        </form>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <h2>Parámetros financieros y salario</h2>
          <span className="tag">
            {hasHistory
              ? "Nueva versión futura"
              : "Confirmar hipótesis iniciales"}
          </span>
        </div>
        <form onSubmit={save} className="settings-form">
          <div className="form-grid three">
            <label>
              Vigente desde
              <input
                name="effectivePeriod"
                type="month"
                defaultValue={hasHistory ? next : d.versions[0].effectivePeriod}
                required
              />
            </label>
            <label>
              Primer vencimiento
              <input
                name="firstDue"
                type="date"
                defaultValue={hasHistory ? undefined : d.versions[0].firstDue}
                value={hasHistory ? d.versions[0].firstDue : undefined}
                readOnly={hasHistory}
                required
              />
            </label>
            <label className="checkbox">
              <input
                name="provisional"
                type="checkbox"
                defaultChecked={p.provisional}
              />{" "}
              Fecha provisional
            </label>
            <label>
              Interés anual (decimal, 0.095 = 9.50%)
              <input
                name="interest"
                type="number"
                step="0.00000001"
                min="0"
                max="0.99"
                defaultValue={p.interest}
                required
              />
            </label>
            <label>
              FECI anual (decimal, 0.01 = 1%)
              <input
                name="feci"
                type="number"
                step="0.00000001"
                min="0"
                max="0.99"
                defaultValue={p.feci}
                required
              />
            </label>
            <label>
              Cuota regular BG (USD)
              <input
                name="regular"
                type="number"
                step="0.01"
                min="0.01"
                defaultValue={(p.regular / 100).toFixed(2)}
                required
              />
            </label>
            <label>
              Cuota fija Chunky (USD)
              <input
                name="chunky"
                type="number"
                step="0.01"
                min="0"
                defaultValue={(p.chunky / 100).toFixed(2)}
                required
              />
            </label>
            <label>
              Cuota adicional CrediJamar (USD)
              <input
                name="credi"
                type="number"
                step="0.01"
                min="0.01"
                defaultValue={(p.credi / 100).toFixed(2)}
                required
              />
            </label>
            <label>
              Salario mensual indicado (USD)
              <input
                name="salary"
                type="number"
                step="0.01"
                min="0.01"
                defaultValue={(p.salary / 100).toFixed(2)}
                required
              />
            </label>
          </div>
          <label className="checkbox">
            <input
              name="salaryIncludesLoan"
              type="checkbox"
              defaultChecked={p.salaryIncludesLoan}
            />
            El salario indicado ya incluye el descuento del préstamo (evitar
            doble descuento)
          </label>
          <label>
            Motivo del cambio
            <textarea
              name="reason"
              required
              minLength={5}
              maxLength={500}
              placeholder="Información real confirmada o decisión para la nueva vigencia"
              rows={2}
            />
          </label>
          <button className="button primary" disabled={busy}>
            <Save size={17} />
            {busy ? "Guardando…" : "Guardar parámetros con auditoría"}
          </button>
        </form>
      </section>
      <section className="panel section-gap">
        <div className="panel-heading">
          <h2>Responsabilidad compartida de CrediJamar</h2>
          <span className="tag">Sin reparto automático</span>
        </div>
        <p className="fine-print">
          Puedes asignar porcentajes por persona. La parte sin asignar permanece
          desconocida. El nombre «Javier» identifica tu parte para la referencia
          del presupuesto; cada aporte conserva quién pagó realmente.
        </p>
        <form className="settings-form" onSubmit={(e) => save(e, true)}>
          <label>
            Vigente desde
            <input
              type="month"
              name="effectivePeriod"
              defaultValue={next}
              required
            />
          </label>
          {people.map((x, i) => (
            <div className="participant-row" key={i}>
              <label>
                Nombre
                <input
                  value={x.name}
                  onChange={(e) =>
                    setPeople(
                      people.map((x, j) =>
                        i === j ? { ...x, name: e.target.value } : x,
                      ),
                    )
                  }
                  placeholder="Nombre de la persona"
                  required
                />
              </label>
              <label>
                Responsabilidad (%)
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={x.percent}
                  onChange={(e) =>
                    setPeople(
                      people.map((x, j) =>
                        i === j ? { ...x, percent: e.target.value } : x,
                      ),
                    )
                  }
                  required
                />
              </label>
              <button
                className="text-button"
                type="button"
                aria-label="Quitar persona"
                onClick={() => setPeople(people.filter((_, j) => j !== i))}
              >
                <Trash2 size={18} />
              </button>
            </div>
          ))}
          <button
            className="text-button"
            type="button"
            onClick={() => setPeople([...people, { name: "", percent: "" }])}
          >
            <Plus size={17} />
            Añadir persona
          </button>
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
          <button className="button primary" disabled={busy}>
            <Save size={17} />
            Guardar responsabilidad
          </button>
        </form>
        {d.participants.map((r) => (
          <p className="notice" key={r.id}>
            Desde {r.effective_period}:{" "}
            {r.participants
              .map((x: any) => `${x.name} ${x.percent}%`)
              .join(" · ")}
          </p>
        ))}
      </section>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <section className="panel section-gap">
        <div className="panel-heading">
          <h2>Versiones e hipótesis de cálculo</h2>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Vigencia</th>
                <th>Interés / FECI</th>
                <th>Regular / Chunky / CrediJamar</th>
                <th>Primer vencimiento</th>
              </tr>
            </thead>
            <tbody>
              {d.versions.map((v) => (
                <tr key={v.effectivePeriod}>
                  <td>{v.effectivePeriod}</td>
                  <td>
                    {Number(v.interest) * 100}% / {Number(v.feci) * 100}%
                  </td>
                  <td>
                    ${(v.regular / 100).toFixed(2)} / $
                    {(v.chunky / 100).toFixed(2)} / $
                    {(v.credi / 100).toFixed(2)}
                  </td>
                  <td>
                    {displayDate(v.originalFirstDue ?? v.firstDue)}
                    <small>
                      {(v.originalProvisional ?? v.provisional)
                        ? "Provisional en esta versión"
                        : "Confirmado en esta versión"}
                    </small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="fine-print">
          Modelo mensual, sin prorrateo por días. El pago regular cubre interés,
          FECI y después otros cargos explícitos pendientes; el remanente
          amortiza capital. Es una convención de cálculo, pendiente de confirmar
          con Banco General. Cargos impagos y compensaciones no se capitalizan.
          Se redondean los devengos legales a centavos y se distribuyen por
          mayores residuos con desempate estable Chunky, CrediJamar, tarjetas y
          costos.
        </p>
      </section>
    </>
  );
}
