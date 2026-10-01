"use client";
import { Info, AlertCircle } from "lucide-react";
import type { budgetFor } from "@/lib/budget";
import { usd } from "./dashboard";
export default function BudgetCategories({
  b,
}: {
  b: ReturnType<typeof budgetFor>;
}) {
  return (
    <section className="panel section-gap">
      <div className="panel-heading">
        <h2>Disponible por categoría</h2>
        <span className="tag">Presupuesto 50 / 30 / 20</span>
      </div>
      <div className="expense-budget-grid">
        {b.categories.map((c, i) => (
          <article className="expense-budget" key={c.id}>
            <span className={`dot ${["chunky", "credi", "cards"][i]}`} />
            <h3>{c.name}</h3>
            <strong className={c.remaining < 0 ? "expense-negative" : ""}>
              {usd(c.remaining)}
            </strong>
            <small>
              {c.remaining < 0
                ? "Por encima del presupuesto"
                : "Disponible sin comprometer"}
            </small>
            <div className="composition-line">
              <span>Presupuesto</span>
              <b>{usd(c.limit)}</b>
            </div>
            <div className="composition-line">
              <span>Usado</span>
              <b>{usd(c.used)}</b>
            </div>
            {c.reserved > 0 && (
              <div className="composition-line">
                <span>Fijos pendientes</span>
                <b>{usd(c.reserved)}</b>
              </div>
            )}
          </article>
        ))}
      </div>
      <p className="fine-print">
        Necesidades 50%, personal 30% y ahorro/deuda 20%. Ahorro y deuda ya
        descuenta tu carga regular BG; los abonos voluntarios se descuentan
        cuando los registras. Los fijos pendientes reservan presupuesto, pero no
        salen de caja hasta pagarlos.
      </p>
      {b.categories.some((c) => c.remaining < 0) && (
        <p className="warning" role="status">
          <AlertCircle size={17} />
          Hay una categoría por encima del presupuesto. El gasto real se
          conserva; revisa tus próximos pagos.
        </p>
      )}
      {b.unclassified > 0 && (
        <p className="notice">
          <Info size={17} />
          {usd(b.unclassified)} en «Otros» salen de caja, pero no tienen
          categoría de presupuesto. Puedes corregir esos registros.
        </p>
      )}
    </section>
  );
}
