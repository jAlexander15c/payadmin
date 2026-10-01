"use client";
import type { expensesFor } from "@/lib/expenses";
import { usd, displayDate } from "./dashboard";
export default function ExpenseCharts({
  b,
}: {
  b: ReturnType<typeof expensesFor>;
}) {
  const colors = ["#6bb59c", "#b297d5", "#ddb978"],
    max = Math.max(1, ...b.daily.flatMap((r) => [r.income, r.spent]));
  let start = 0;
  const gradient = b.categories
    .map((c, i) => {
      const from = start;
      start += c.share;
      return `${colors[i]} ${from}% ${start}%`;
    })
    .join(", ");
  return (
    <>
      <div className="expense-charts section-gap">
        <section className="panel">
          <div className="panel-heading">
            <h2>Consumo por categoría</h2>
          </div>
          {!b.spent ? (
            <p className="empty-inline">
              Registra una salida para ver cómo se distribuye tu consumo.
            </p>
          ) : (
            <div className="expense-consumption">
              <div
                className="expense-donut"
                role="img"
                aria-label={`Total consumido: ${usd(b.spent)}. ${b.categories.map((c) => `${c.name}: ${usd(c.spent)}, ${c.share.toFixed(1)}%`).join(". ")}`}
                style={{ background: `conic-gradient(${gradient})` }}
              >
                <div>
                  <small>Salidas</small>
                  <strong>{usd(b.spent)}</strong>
                </div>
              </div>
              <div className="expense-chart-legend">
                {b.categories.map((c, i) => (
                  <div className="composition-line" key={c.id}>
                    <span>
                      <i style={{ background: colors[i] }} />
                      {c.name}
                    </span>
                    <b>
                      {usd(c.spent)}
                      <small>{c.share.toFixed(1)}% del consumo</small>
                    </b>
                  </div>
                ))}
              </div>
            </div>
          )}
          <p className="fine-print">
            Distribución de las salidas reales de este período. Los ingresos y
            ajustes de saldo no se cuentan como consumo.
          </p>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <h2>Entradas y salidas por día</h2>
          </div>
          <div className="expense-flow-key">
            <span>● Entradas</span>
            <span>● Salidas</span>
          </div>
          {!b.daily.length ? (
            <p className="empty-inline">
              Tus movimientos aparecerán aquí al registrarlos.
            </p>
          ) : (
            <div
              className="expense-daily"
              role="list"
              aria-label="Movimientos diarios"
            >
              {b.daily.map((day) => (
                <div className="expense-day" key={day.date} role="listitem">
                  <time dateTime={day.date}>{displayDate(day.date)}</time>
                  <div>
                    <div className="expense-bar-track">
                      <span
                        className="expense-in-bar"
                        style={{ width: `${(day.income / max) * 100}%` }}
                      />
                    </div>
                    <small>Entra {usd(day.income)}</small>
                  </div>
                  <div>
                    <div className="expense-bar-track">
                      <span
                        className="expense-out-bar"
                        style={{ width: `${(day.spent / max) * 100}%` }}
                      />
                    </div>
                    <small>Sale {usd(day.spent)}</small>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
      <section className="panel section-gap">
        <div className="panel-heading">
          <h2>Consumo frente a tu salario</h2>
          <span className="tag">Salario del período: {usd(b.salary)}</span>
        </div>
        <div className="expense-budget-grid">
          {b.categories.map((c, i) => (
            <article className="expense-budget" key={c.id}>
              <h3>{c.name}</h3>
              <strong>{usd(c.spent)}</strong>
              <small>Consumido en este período</small>
              <div className="composition-line">
                <span>Referencia salarial ({[50, 30, 20][i]}%)</span>
                <b>{usd(c.salaryReference)}</b>
              </div>
              <div className="composition-line">
                <span>Consumo de esa referencia</span>
                <b>
                  {c.salaryPercent === null
                    ? "Sin salario configurado"
                    : `${c.salaryPercent.toFixed(1)}%`}
                </b>
              </div>
              <div className="composition-line">
                <span>Entradas registradas aquí</span>
                <b>{usd(c.income)}</b>
              </div>
            </article>
          ))}
        </div>
        <p className="fine-print">
          Esta comparación usa únicamente tu salario configurado y la referencia
          50/30/20. Los ingresos extra no cambian esa base. Los saldos de Mis
          totales indican lo que tienes disponible; no se estiman a partir del
          salario.
        </p>
      </section>
    </>
  );
}
