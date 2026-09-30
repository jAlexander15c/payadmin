"use client";
import { useEffect, useRef, useState } from "react";
import { X, Check, Info, Trash2, Plus } from "lucide-react";
import { type Snapshot, type Edit, names, typeNames, usd } from "./dashboard";
type Kind = "bank" | "contribution" | "cash" | "statement";
export default function MovementForm({
  kind: initialKind,
  d,
  edit,
  close,
  onSaved,
}: {
  kind: Kind;
  d: Snapshot;
  edit: Edit | null;
  close: () => void;
  onSaved: (s: string) => Promise<void>;
}) {
  const [kind, setKind] = useState<Kind>(initialKind),
    [type, setType] = useState(edit?.record.type || "REGULAR"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [voiding, setVoiding] = useState(false),
    [extract, setExtract] = useState(false),
    [period, setPeriod] = useState(
      edit?.record.period ||
        (initialKind === "cash" || initialKind === "contribution"
          ? d.asOf.slice(0, 7)
          : d.asOf.slice(0, 7) < d.versions[0].firstDue.slice(0, 7)
            ? d.versions[0].firstDue.slice(0, 7)
            : d.asOf.slice(0, 7)),
    );
  const [links, setLinks] = useState<{ id: string; amount: string }[]>(
    edit?.kind === "bank"
      ? d.links
          .filter((x) => x.movement_id === edit.record.id)
          .map((x) => ({ id: x.contribution_id, amount: x.amount }))
      : [],
  );
  const key = useRef(edit?.record.request_key || crypto.randomUUID()),
    dialog = useRef<HTMLDialogElement>(null),
    ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);
  const r = edit?.record,
    statement = d.statements.find((s) => s.period === period);
  const title = voiding
    ? "Anular movimiento"
    : edit
      ? "Corregir movimiento"
      : kind === "bank"
        ? "Registrar pago al banco"
        : kind === "contribution"
          ? "Registrar aporte recibido"
          : kind === "cash"
            ? "Registrar caja personal"
            : "Datos confirmados del extracto";
  async function post(path: string, data: unknown) {
    const res = await fetch("/api/" + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error);
    return j;
  }
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget),
      s = (name: string) => String(f.get(name) || "");
    try {
      if (voiding && edit) {
        await post(`${edit.kind}/${r!.id}`, {
          revision: r!.revision,
          action: "void",
          reason: s("reason"),
        });
        await onSaved(
          "Movimiento anulado. Se recalcularon los períodos afectados.",
        );
        return;
      }
      let body: Record<string, unknown> = {
        requestKey: key.current,
        date: s("date"),
        period,
        amount: type === "NO_PAYMENT" && kind === "bank" ? "0" : s("amount"),
      };
      if (kind === "bank")
        body = {
          ...body,
          type,
          notes: s("notes"),
          links: links.filter((l) => l.id && l.amount),
        };
      else if (kind === "contribution")
        body = {
          ...body,
          source: s("source"),
          contributor: s("contributor"),
          notes: s("notes"),
        };
      else if (kind === "cash")
        body = {
          ...body,
          kind: s("cashKind"),
          category: s("category"),
          concept: s("concept"),
        };
      const statementBody = {
        period,
        interest: s("interest"),
        feci: s("feci"),
        other: s("other"),
        concept: s("otherConcept"),
        principal: s("principal"),
        balance: s("balance"),
        notes: s("statementNotes"),
        reason: s("reason") || "Datos confirmados del extracto bancario",
      };
      if (kind === "statement") await post("statement", statementBody);
      else if (edit)
        await post(`${edit.kind}/${r!.id}`, {
          revision: r!.revision,
          action: "correct",
          reason: s("reason"),
          data: body,
        });
      else await post(kind, body);
      if (kind === "bank" && extract) {
        try {
          await post("statement", statementBody);
        } catch (e) {
          setError(
            "El pago quedó guardado. El extracto sigue pendiente: " +
              (e instanceof Error ? e.message : "intenta nuevamente."),
          );
          setBusy(false);
          setExtract(false);
          await onSaved("Pago guardado; ingresa el extracto desde Controles.");
          return;
        }
      }
      await onSaved(
        edit
          ? "Corrección guardada con auditoría y recálculo."
          : kind === "contribution"
            ? "Aporte recibido guardado. Todavía no se aplicó al banco."
            : "Registro guardado en PostgreSQL.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar.");
      setBusy(false);
    }
  }
  return (
    <dialog
      className="modal"
      ref={dialog}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) close();
      }}
      aria-labelledby="movement-title"
    >
      <div className="modal-heading">
        <div>
          <span className="eyebrow">
            {edit ? "CORRECCIÓN CON AUDITORÍA" : "MOVIMIENTO REAL"}
          </span>
          <h2 id="movement-title">{title}</h2>
        </div>
        <button
          type="button"
          aria-label="Cerrar formulario"
          onClick={close}
          disabled={busy}
        >
          <X size={22} />
        </button>
      </div>
      {!edit && (
        <div className="tabs modal-tabs">
          {(["bank", "contribution", "cash", "statement"] as Kind[]).map(
            (k) => (
              <button
                type="button"
                className={kind === k ? "active" : ""}
                key={k}
                onClick={() => {
                  setKind(k);
                  setError("");
                }}
              >
                {k === "bank"
                  ? "Banco"
                  : k === "contribution"
                    ? "Aporte"
                    : k === "cash"
                      ? "Caja"
                      : "Extracto"}
              </button>
            ),
          )}
        </div>
      )}
      <form ref={ref} onSubmit={submit}>
        <div className="modal-body">
          {voiding ? (
            <p className="warning">
              <Info size={17} />
              El registro se conservará como anulado. Sus efectos se retirarán
              del cálculo, sin borrar el historial. Si un aporte tiene
              aplicaciones, primero debes corregirlas.
            </p>
          ) : (
            <>
              <div className="form-grid">
                <label>
                  Fecha real
                  <input
                    name="date"
                    type="date"
                    defaultValue={r?.date || d.asOf}
                    max={d.asOf}
                    required={kind !== "statement"}
                    disabled={kind === "statement"}
                  />
                </label>
                <label>
                  Período
                  <input
                    type="month"
                    value={period}
                    onChange={(e) => setPeriod(e.target.value)}
                    required
                  />
                </label>
              </div>
              {kind === "bank" && (
                <>
                  <label>
                    Tipo de movimiento
                    <select
                      name="type"
                      value={type}
                      onChange={(e) => setType(e.target.value)}
                    >
                      {[
                        "REGULAR",
                        "CREDI",
                        "EXTRA_CREDI",
                        "EXTRA_CHUNKY",
                        "EXTRA_CARDS",
                        "EXTRA_COSTS",
                        "NO_PAYMENT",
                      ].map((t) => (
                        <option value={t} key={t}>
                          {typeNames[t]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="notice">
                    <Info size={17} />
                    {type === "REGULAR"
                      ? "Pago real descontado de planilla. Puede ser parcial o quincenal; no se marca una cuota completa como pagada automáticamente."
                      : type === "CREDI"
                        ? "Aplicación adicional al capital legal BG. Primero compensa únicamente cargos CrediJamar ya financiados por Javier; el resto reduce capital CrediJamar."
                        : type === "NO_PAYMENT"
                          ? "Confirmas que no hubo pagos en este período. Un mes sin registros sigue siendo desconocido."
                          : "Reduce exclusivamente el capital del destino elegido. El exceso queda sin aplicar; no se reasigna."}
                  </p>
                </>
              )}
              {kind === "contribution" && (
                <div className="form-grid">
                  <label>
                    Origen / responsabilidad
                    <select
                      name="source"
                      defaultValue={r?.source_id || "chunky"}
                    >
                      {Object.entries(names).map(([s, n]) => (
                        <option key={s} value={s}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Persona o negocio que aporta
                    <input
                      name="contributor"
                      defaultValue={r?.contributor || ""}
                      placeholder="Ej. Chunky Bites, Javier…"
                      maxLength={100}
                      required
                    />
                  </label>
                </div>
              )}
              {kind === "cash" && (
                <div className="form-grid">
                  <label>
                    Tipo
                    <select name="cashKind" defaultValue={r?.kind || "EXPENSE"}>
                      {["PAYROLL", "INCOME", "EXPENSE", "SAVING"].map((k) => (
                        <option key={k} value={k}>
                          {typeNames[k]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Categoría
                    <select
                      name="category"
                      defaultValue={r?.category || "NEEDS"}
                    >
                      <option value="NEEDS">Necesidades</option>
                      <option value="WANTS">Gustos</option>
                      <option value="DEBT">Deuda fuera de BG</option>
                      <option value="SAVINGS">Ahorro</option>
                      <option value="OTHER">Otros</option>
                    </select>
                  </label>
                </div>
              )}
              {kind !== "statement" && (
                <label>
                  Importe (USD)
                  <div className="currency-input">
                    <span>$</span>
                    <input
                      name="amount"
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min={
                        type === "NO_PAYMENT" && kind === "bank" ? "0" : "0.01"
                      }
                      max="99999999"
                      defaultValue={r?.amount || ""}
                      required
                      disabled={type === "NO_PAYMENT" && kind === "bank"}
                      placeholder={
                        kind === "bank" && type === "REGULAR"
                          ? "158.80 / 317.60"
                          : "0.00"
                      }
                    />
                  </div>
                </label>
              )}
              {kind === "cash" ? (
                <>
                  <label>
                    Concepto
                    <input
                      name="concept"
                      defaultValue={r?.concept || ""}
                      required
                      maxLength={200}
                      placeholder="Ej. Supermercado, planilla recibida…"
                    />
                  </label>
                  <p className="fine-print">
                    Planilla: registra el neto que recibiste en efectivo. No
                    registres aquí nuevamente pagos o reembolsos que ya
                    guardaste en Banco o Aportes.
                  </p>
                </>
              ) : (
                kind !== "statement" && (
                  <label>
                    Observaciones
                    <textarea
                      name="notes"
                      defaultValue={r?.notes || ""}
                      rows={2}
                      maxLength={2000}
                      placeholder="Referencia, descuento o detalle del movimiento"
                    />
                  </label>
                )
              )}
              {kind === "bank" && type !== "NO_PAYMENT" && (
                <div className="link-block">
                  <div className="form-heading">
                    <strong>Vincular aporte recibido</strong>
                    <button
                      className="text-button"
                      type="button"
                      onClick={() =>
                        setLinks([...links, { id: "", amount: "" }])
                      }
                    >
                      <Plus size={15} />
                      Añadir
                    </button>
                  </div>
                  <small>
                    Opcional. El vínculo explica el origen; no crea un segundo
                    pago.
                  </small>
                  {links.map((l, i) => (
                    <div className="link-row" key={i}>
                      <label className="sr-only" htmlFor={"link-" + i}>
                        Aporte recibido {i + 1}
                      </label>
                      <select
                        id={"link-" + i}
                        value={l.id}
                        onChange={(e) =>
                          setLinks(
                            links.map((x, j) =>
                              j === i ? { ...x, id: e.target.value } : x,
                            ),
                          )
                        }
                      >
                        <option value="">Selecciona un aporte</option>
                        {d.contributions
                          .filter((r) => r.status === "active")
                          .map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.contributor} · {r.date} ·{" "}
                              {usd(Math.round(Number(r.amount) * 100))}
                            </option>
                          ))}
                      </select>
                      <input
                        aria-label="Importe vinculado USD"
                        type="number"
                        step="0.01"
                        min="0.01"
                        placeholder="USD"
                        value={l.amount}
                        onChange={(e) =>
                          setLinks(
                            links.map((x, j) =>
                              j === i ? { ...x, amount: e.target.value } : x,
                            ),
                          )
                        }
                        required={!!l.id}
                      />
                      <button
                        aria-label="Quitar vínculo"
                        type="button"
                        onClick={() =>
                          setLinks(links.filter((_, j) => j !== i))
                        }
                      >
                        <X size={17} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {kind === "bank" && (
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={extract}
                    onChange={(e) => setExtract(e.target.checked)}
                  />{" "}
                  Añadir datos del extracto (opcionales)
                </label>
              )}
              {(kind === "statement" || extract) && (
                <fieldset className="statement-fields">
                  <legend>Información confirmada del banco</legend>
                  <p className="fine-print">
                    Vacío = desconocido. 0 = cero confirmado. Capital y saldo
                    reportados se comparan; nunca reemplazan automáticamente el
                    cálculo.
                  </p>
                  <div className="form-grid">
                    <label>
                      Interés devengado
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        name="interest"
                        defaultValue={
                          statement?.interest == null
                            ? ""
                            : (statement.interest / 100).toFixed(2)
                        }
                        placeholder="Desconocido"
                      />
                    </label>
                    <label>
                      FECI devengado
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        name="feci"
                        defaultValue={
                          statement?.feci == null
                            ? ""
                            : (statement.feci / 100).toFixed(2)
                        }
                        placeholder="Desconocido"
                      />
                    </label>
                    <label>
                      Otros cargos devengados
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        name="other"
                        defaultValue={
                          statement?.other == null
                            ? ""
                            : (statement.other / 100).toFixed(2)
                        }
                        placeholder="Desconocido"
                      />
                    </label>
                    <label>
                      Concepto de otros cargos
                      <input
                        name="otherConcept"
                        defaultValue={statement?.concept || ""}
                        maxLength={200}
                      />
                    </label>
                    <label>
                      Capital amortizado reportado
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        name="principal"
                        defaultValue={
                          statement?.principal == null
                            ? ""
                            : (statement.principal / 100).toFixed(2)
                        }
                        placeholder="Desconocido"
                      />
                    </label>
                    <label>
                      Saldo capital reportado
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        name="balance"
                        defaultValue={
                          statement?.balance == null
                            ? ""
                            : (statement.balance / 100).toFixed(2)
                        }
                        placeholder="Desconocido"
                      />
                    </label>
                  </div>
                  <label>
                    Nota del extracto
                    <textarea name="statementNotes" rows={2} maxLength={2000} />
                  </label>
                </fieldset>
              )}
            </>
          )}
          {(edit || kind === "statement") && (
            <label>
              Motivo para la auditoría
              <textarea
                name="reason"
                required
                minLength={5}
                maxLength={500}
                rows={2}
                placeholder="Explica la corrección o qué dato confirmó el banco"
              />
            </label>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="modal-footer">
          {edit && !voiding && (
            <button
              type="button"
              className="text-button danger"
              onClick={() => setVoiding(true)}
            >
              <Trash2 size={16} />
              Anular
            </button>
          )}
          <button
            className="button secondary"
            type="button"
            onClick={voiding ? () => setVoiding(false) : close}
            disabled={busy}
          >
            Cancelar
          </button>
          <button
            className={"button " + (voiding ? "danger-button" : "primary")}
            disabled={busy}
          >
            {busy
              ? "Guardando…"
              : voiding
                ? "Anular con auditoría"
                : edit
                  ? "Guardar corrección"
                  : "Guardar registro"}
            <Check size={17} />
          </button>
        </div>
      </form>
    </dialog>
  );
}
