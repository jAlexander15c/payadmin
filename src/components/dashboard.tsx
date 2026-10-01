"use client";
import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  ArrowUpRight,
  ArrowDownLeft,
  ArrowRight,
  Plus,
  Wallet,
  ChartNoAxesCombined,
  ListChecks,
  Settings2,
  History,
  ChevronRight,
  LogOut,
  LockKeyhole,
  Menu,
  X,
  Download,
  Check,
  Clock3,
  Info,
  Banknote,
  ReceiptText,
  TrendingDown,
  CalendarDays,
  CheckCircle2,
  AlertCircle,
  Search,
} from "lucide-react";
import type { snapshot } from "@/lib/store";
import type { Source, Forecast } from "@/lib/finance";
import MovementForm from "./movement-form";
import SettingsForm from "./settings-form";
import CashCompensations from "./cash-compensations";
import Expenses from "./expenses";
import BudgetCategories from "./budget-categories";
export type Snapshot = Awaited<ReturnType<typeof snapshot>>;
export const names: Record<Source, string> = {
  chunky: "Chunky Bites",
  credi: "CrediJamar",
  cards: "Tarjetas personales",
  costs: "Costos / otros",
};
const initials: Record<Source, string> = {
  chunky: "CB",
  credi: "CJ",
  cards: "JA",
  costs: "CO",
};
const initial: Record<Source, number> = {
  chunky: 702434,
  credi: 134900,
  cards: 800308,
  costs: 177358,
};
export const usd = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    cents / 100,
  );
export const displayDate = (s: string | null | undefined) =>
  s
    ? new Intl.DateTimeFormat("es-PA", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        timeZone: "America/Panama",
      }).format(new Date(s + "T12:00:00Z"))
    : "Pendiente";
function expectedChunky(d: Snapshot) {
  const b = d.real.bags.chunky,
    n = d.current.schedule[0]?.sources?.chunky;
  return Math.min(
    d.parameters.chunky,
    b.capital +
      b.interest +
      b.feci +
      b.other +
      (n ? n.interest + n.feci + n.other : 0),
  );
}
function expectedCredi(d: Snapshot) {
  return d.current.schedule[0]?.credi || 0;
}
export const typeNames: Record<string, string> = {
  REGULAR: "Pago regular BG",
  CREDI: "Abono voluntario CrediJamar",
  EXTRA_CREDI: "Extra a capital CrediJamar",
  EXTRA_CHUNKY: "Extra a capital Chunky",
  EXTRA_CARDS: "Extra a tarjetas",
  EXTRA_COSTS: "Extra a costos / otros",
  NO_PAYMENT: "Sin pago confirmado",
  PAYROLL: "Planilla recibida (neta)",
  INCOME: "Otro ingreso",
  EXPENSE: "Gasto",
  SAVING: "Ahorro líquido",
  SAVINGS_OPENING: "Saldo previo de ahorro",
};
const nav = [
  { id: "overview", label: "Resumen", icon: LayoutDashboard },
  { id: "movements", label: "Movimientos", icon: ReceiptText },
  { id: "sources", label: "Responsabilidades", icon: Wallet },
  { id: "forecast", label: "Proyecciones", icon: ChartNoAxesCombined },
  { id: "budget", label: "Mi presupuesto", icon: Banknote },
  { id: "expenses", label: "Mis gastos", icon: ReceiptText },
  { id: "controls", label: "Controles de cuadre", icon: ListChecks },
];
export type Edit = {
  kind: "bank" | "contribution" | "cash";
  record: Record<string, any>;
};
export default function Dashboard({
  initial: data,
  email,
}: {
  initial: Snapshot;
  email: string;
}) {
  const [d, setD] = useState(data),
    [page, setPage] = useState("overview"),
    [selectedSource, setSelectedSource] = useState<Source>("chunky"),
    [mobile, setMobile] = useState(false),
    [form, setForm] = useState<
      "bank" | "contribution" | "cash" | "statement" | null
    >(null),
    [edit, setEdit] = useState<Edit | null>(null),
    [toast, setToast] = useState("");
  useEffect(() => {
    if ("serviceWorker" in navigator)
      navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  async function refresh() {
    const r = await fetch("/api/snapshot", { cache: "no-store" });
    if (!r.ok) {
      if (r.status === 401) location.assign("/login");
      throw new Error("No se pudo actualizar la información.");
    }
    setD(await r.json());
  }
  async function saved(message: string) {
    await refresh();
    setForm(null);
    setEdit(null);
    setToast(message);
    setTimeout(() => setToast(""), 6000);
  }
  function go(id: string) {
    setPage(id);
    setMobile(false);
  }
  const title =
    page === "settings"
      ? "Configuración"
      : page === "history"
        ? "Historial y auditoría"
        : nav.find((n) => n.id === page)?.label || "Resumen";
  return (
    <div className="app-shell">
      <aside className={"sidebar " + (mobile ? "open" : "")}>
        <a className="brand" href="/" aria-label="PayAdmin inicio">
          <span className="brand-mark">p</span>PayAdmin
          <span className="brand-dot">.</span>
        </a>
        <div className="workspace-label">MI ESPACIO PERSONAL</div>
        <nav aria-label="Navegación principal">
          {nav.map((n) => (
            <button
              key={n.id}
              onClick={() => go(n.id)}
              className={page === n.id ? "nav-item active" : "nav-item"}
            >
              <n.icon size={19} />
              {n.label}
              {page === n.id && <span className="nav-indicator" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-plan">
          <span className="mini-icon">
            <TrendingDown size={19} />
          </span>
          <strong>Cada abono cuenta.</strong>
          <p>
            Tu plan, un paso más cerca
            <br />
            de estar libre de deudas.
          </p>
          <button onClick={() => go("forecast")}>
            Explorar proyecciones <ArrowUpRight size={15} />
          </button>
        </div>
        <div className="sidebar-bottom">
          <button
            className={"nav-item " + (page === "history" ? "active" : "")}
            onClick={() => go("history")}
          >
            <History size={19} />
            Historial y auditoría
          </button>
          <button
            className={"nav-item " + (page === "settings" ? "active" : "")}
            onClick={() => go("settings")}
          >
            <Settings2 size={19} />
            Configuración
          </button>
          <div className="profile">
            <span className="avatar">JA</span>
            <div>
              <strong>Javier Alexander</strong>
              <small>Cuenta personal</small>
            </div>
            <button
              aria-label="Cerrar sesión"
              onClick={async () => {
                const r = await fetch("/api/logout", { method: "POST" });
                if (r.ok) location.assign("/login");
                else
                  setToast("No se pudo cerrar la sesión. Intenta nuevamente.");
              }}
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      {mobile && (
        <button
          className="nav-backdrop"
          aria-label="Cerrar menú"
          onClick={() => setMobile(false)}
        />
      )}
      <div className="main-shell">
        <header className="topbar">
          <div>
            <button
              className="mobile-menu"
              aria-label="Abrir navegación"
              onClick={() => setMobile(true)}
            >
              <Menu size={22} />
            </button>
            <span className="breadcrumb">
              <span className="breadcrumb-origin">Mi espacio</span>{" "}
              <ChevronRight size={14} />
              <strong>{title}</strong>
            </span>
          </div>
          <div className="topbar-right">
            <span className="private-pill">
              <LockKeyhole size={13} /> Espacio privado
            </span>
            <span className="top-date">{displayDate(d.asOf)}</span>
            <span className="avatar small">JA</span>
          </div>
        </header>
        <main className="content">
          <div className="page-heading">
            <div>
              <span className="eyebrow">TU PLAN FINANCIERO, CON CLARIDAD</span>
              <h1>
                {page === "overview" ? "Hola, Javier" : title}
                <span className="heading-dot">.</span>
              </h1>
              <p>
                {page === "overview"
                  ? "Consulta tu saldo y registra tus pagos y aportes."
                  : "Información trazable para tomar decisiones con tus números."}
              </p>
            </div>
            <div className="heading-actions">
              <a
                className="button secondary export-main"
                href={
                  page === "expenses"
                    ? "/api/export?kind=budget"
                    : "/api/export"
                }
              >
                <Download size={16} />
                Exportar
              </a>
              <button
                className="button primary"
                onClick={() =>
                  page === "expenses" ? go("budget") : setForm("bank")
                }
              >
                {page === "expenses" ? (
                  <ArrowUpRight size={18} />
                ) : (
                  <Plus size={18} />
                )}
                {page === "expenses"
                  ? "Ver presupuesto"
                  : "Registrar movimiento"}
              </button>
            </div>
          </div>
          {page === "overview" && (
            <Overview
              d={d}
              go={go}
              openSource={(s) => {
                setSelectedSource(s);
                go("sources");
              }}
              register={() => setForm("bank")}
            />
          )}
          {page === "movements" && (
            <Movements
              d={d}
              onSaved={() => saved("Compensación guardada y conciliada.")}
              open={setForm}
              edit={(r) => {
                setEdit(r);
                setForm(r.kind);
              }}
            />
          )}
          {page === "sources" && (
            <Sources
              d={d}
              selected={selectedSource}
              setSelected={setSelectedSource}
            />
          )}
          {page === "forecast" && <Projections d={d} />}
          {page === "budget" && <Budget d={d} open={() => setForm("cash")} />}
          {page === "expenses" && (
            <Expenses
              d={d}
              onSaved={saved}
              edit={(record) => {
                setEdit({ kind: "cash", record });
                setForm("cash");
              }}
            />
          )}
          {page === "controls" && (
            <Controls d={d} open={() => setForm("statement")} />
          )}
          {page === "settings" && (
            <SettingsForm
              d={d}
              onSaved={() =>
                saved("Configuración guardada con su vigencia y auditoría.")
              }
            />
          )}
          {page === "history" && <HistoryView d={d} />}
          <footer className="footer">
            <span>
              <span className="footer-dot" />
              Datos persistidos en PostgreSQL
            </span>
            <span>
              USD · America/Panama <span className="footer-divider">/</span>{" "}
              Cálculos mensuales estimados
            </span>
          </footer>
        </main>
      </div>
      {(form || edit) && (
        <MovementForm
          kind={form || "bank"}
          d={d}
          edit={edit}
          close={() => {
            setForm(null);
            setEdit(null);
          }}
          onSaved={saved}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={19} />
          {toast}
          <button aria-label="Cerrar aviso" onClick={() => setToast("")}>
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
function Metric({
  label,
  value,
  note,
  icon: Icon,
}: {
  label: string;
  value: string;
  note: string;
  icon: typeof Wallet;
}) {
  return (
    <div className="metric">
      <div className="metric-top">
        <span>{label}</span>
        <Icon size={18} />
      </div>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}
function Overview({
  d,
  go,
  register,
  openSource,
}: {
  d: Snapshot;
  go: (id: string) => void;
  register: () => void;
  openSource: (source: Source) => void;
}) {
  const p = d.parameters,
    l = d.real,
    progress = ((1815000 - d.totals.capital) / 1815000) * 100;
  return (
    <>
      <div className="assumption-strip">
        <Info size={16} />
        <span>
          <strong>
            {p.provisional
              ? "Primer vencimiento provisional"
              : "Primer vencimiento confirmado"}
            : {displayDate(p.firstDue)}.
          </strong>{" "}
          La cuota proyectada es {usd(p.regular)}.{" "}
          {p.provisional
            ? "Pendiente del primer descuento real."
            : "Los importes reales se registran por separado."}
        </span>
        <button onClick={() => go("settings")}>
          Revisar <ArrowRight size={15} />
        </button>
      </div>
      <div className="metrics-grid">
        <Metric
          label="Capital pendiente BG"
          value={usd(d.totals.capital)}
          note={`Capital inicial ${usd(1815000)}`}
          icon={Wallet}
        />
        <Metric
          label="Realmente pagado"
          value={usd(l.paid)}
          note="Solo movimientos reales al banco"
          icon={ArrowUpRight}
        />
        <Metric
          label="Capital amortizado"
          value={usd(l.principal)}
          note={`${progress.toFixed(1)}% del capital inicial`}
          icon={TrendingDown}
        />
        <Metric
          label="Cierre estimado"
          value={
            d.current.closeDate
              ? displayDate(d.current.closeDate)
              : "Revisar plan"
          }
          note="Con abonos voluntarios mensuales · Proyección"
          icon={CalendarDays}
        />
      </div>
      <div className="main-grid">
        <section className="panel loan-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">
                UN PRÉSTAMO. CUATRO RESPONSABILIDADES.
              </span>
              <h2>Tu consolidación</h2>
            </div>
            <span className="bank-badge">
              <span className="bank-symbol">BG</span>Banco General
            </span>
          </div>
          <div className="loan-total">
            <strong>{usd(d.totals.capital)}</strong>
            <span>de {usd(1815000)} de capital inicial</span>
          </div>
          <div
            className="segmented-bar"
            aria-label="Capital pendiente por origen respecto al capital inicial BG"
          >
            {(Object.keys(initial) as Source[]).map((s) => (
              <span
                key={s}
                className={s}
                style={{ width: `${(l.bags[s].capital / 1815000) * 100}%` }}
                title={`${names[s]}: ${usd(l.bags[s].capital)}`}
              />
            ))}
          </div>
          <div className="bar-caption">
            <span>Capital pendiente por origen</span>
            <strong>{progress.toFixed(1)}% amortizado</strong>
          </div>
          <div className="loan-legend">
            {(Object.keys(initial) as Source[]).map((s) => (
              <div key={s}>
                <span className={"dot " + s} />
                <span>{names[s]}</span>
                <strong>{usd(l.bags[s].capital)}</strong>
              </div>
            ))}
          </div>
          <div className="loan-foot">
            <span>
              <CheckCircle2 size={16} />
              Los cuatro saldos cuadran con BG
            </span>
            <button onClick={() => go("controls")}>
              Ver controles <ArrowUpRight size={15} />
            </button>
          </div>
        </section>
        <section className="panel payment-panel">
          <div className="panel-heading">
            <h2>El plan de cada mes</h2>
            <span className="tag">Cuota regular fija</span>
          </div>
          <div className="monthly-amount">
            <strong>{usd(p.regular)}</strong>
            <span>Cuota regular descontada de planilla</span>
          </div>
          <div className="split-line">
            <span className="source-icon chunky">CB</span>
            <div>
              <strong>Chunky Bites</strong>
              <small>Aporte mensual fijo mientras exista deuda</small>
            </div>
            <strong>{usd(expectedChunky(d))}</strong>
          </div>
          <div className="split-line">
            <span className="source-icon cards">JA</span>
            <div>
              <strong>Javier</strong>
              <small>Tarjetas, costos y cargos adelantados</small>
            </div>
            <strong>{usd(p.regular - expectedChunky(d))}</strong>
          </div>
          <div className="credi-extra">
            <span className="source-icon credi">CJ</span>
            <div>
              <strong>CrediJamar</strong>
              <small>Abono voluntario · Referencia mensual</small>
            </div>
            <strong>+ {usd(expectedCredi(d))}</strong>
          </div>
          <div className="payment-total">
            <span>Total si haces el abono voluntario</span>
            <strong>{usd(p.regular + expectedCredi(d))}</strong>
          </div>
          <p className="fine-print">
            CrediJamar solo se paga cuando registras su abono. La deducción
            salarial no crea ese pago. Los aportes recibidos se registran por
            separado de su aplicación al banco.
          </p>
        </section>
      </div>
      <div className="section-title">
        <div>
          <h2>Cada responsabilidad, en su lugar</h2>
          <p>
            Progreso calculado con pagos reales; cargos estimados hasta
            confirmar extractos.
          </p>
        </div>
        <button className="text-button" onClick={() => go("sources")}>
          Ver detalle <ArrowRight size={16} />
        </button>
      </div>
      <div className="source-grid">
        {(Object.keys(initial) as Source[]).map((s) => (
          <SourceCard key={s} s={s} d={d} onClick={() => openSource(s)} />
        ))}
      </div>
      <div className="bottom-grid">
        <section className="panel chart-panel">
          <div className="panel-heading">
            <div>
              <h2>Un camino hacia saldo cero</h2>
              <p>Proyección de capital · No son pagos registrados</p>
            </div>
            <span className="chart-key">
              <span className="dot general" />
              Plan habitual
            </span>
          </div>
          <BalanceChart f={d.current} opening={d.totals.capital} />
          <div className="chart-note">
            <TrendingDown size={17} />
            <span>
              Los abonos a capital reducen el plazo. La cuota regular se
              mantiene.
            </span>
            <button onClick={() => go("forecast")}>
              <ArrowUpRight size={17} />
              <span className="sr-only">Ver proyecciones</span>
            </button>
          </div>
        </section>
        <section className="panel quick-panel">
          <div className="panel-heading">
            <h2>Por tener presente</h2>
            <Clock3 size={18} />
          </div>
          <div className="reminder">
            <span className="reminder-icon">
              <CalendarDays size={18} />
            </span>
            <div>
              <strong>Primer pago de BG</strong>
              <p>
                {displayDate(p.firstDue)} ·{" "}
                {p.provisional ? "Fecha provisional" : "Fecha confirmada"}
              </p>
              <small>
                {d.movements.find((m) => m.type === "REGULAR")
                  ? `Primer descuento registrado: ${usd(d.movements.find((m) => m.type === "REGULAR")!.amount)}`
                  : "Importe del primer descuento pendiente"}
              </small>
            </div>
          </div>
          <div className="reminder">
            <span className="reminder-icon purple">
              <Wallet size={18} />
            </span>
            <div>
              <strong>Compensaciones a Javier</strong>
              <p>{usd(l.advance)} pendientes</p>
              <small>Solo adelantos realmente financiados</small>
            </div>
          </div>
          <div className="reminder">
            <span className="reminder-icon warm">
              <ReceiptText size={18} />
            </span>
            <div>
              <strong>Cargos pendientes</strong>
              <p>{usd(d.totals.pending)}</p>
              <small>Interés, FECI y otros sin capitalizar</small>
            </div>
          </div>
          <button className="button secondary full" onClick={register}>
            <Plus size={17} />
            Registrar el próximo movimiento
          </button>
        </section>
      </div>
    </>
  );
}
function SourceCard({
  s,
  d,
  onClick,
}: {
  s: Source;
  d: Snapshot;
  onClick?: () => void;
}) {
  const b = d.real.bags[s],
    pct = (b.amortized / initial[s]) * 100;
  return (
    <button className={"source-card " + s} onClick={onClick}>
      <div className="source-card-top">
        <span className={"source-icon " + s}>{initials[s]}</span>
        <ArrowUpRight size={17} />
      </div>
      <h3>{names[s]}</h3>
      <span className="source-caption">Capital pendiente</span>
      <strong className="source-amount">{usd(b.capital)}</strong>
      <div className="progress-track">
        <span className={s} style={{ width: `${pct}%` }} />
      </div>
      <div className="source-progress">
        <span>{pct.toFixed(1)}% amortizado</span>
        <span>{usd(initial[s])} inicial</span>
      </div>
      <div className="source-card-foot">
        {s === "chunky"
          ? `${usd(expectedChunky(d))} / mes · Fijo / ajuste final`
          : s === "credi"
            ? `${usd(expectedCredi(d))} voluntario / mes · Referencia`
            : s === "cards"
              ? "Responsabilidad de Javier"
              : "Capital separado de tarjetas"}
        <ChevronRight size={14} />
      </div>
    </button>
  );
}
function BalanceChart({ f, opening }: { f: Forecast; opening: number }) {
  const points = [opening, ...f.schedule.map((x) => x.closing)];
  const w = 720,
    h = 220,
    pad = 45,
    max = Math.max(opening, 1);
  const path = points
    .map(
      (v, i) =>
        `${i ? "L" : "M"}${pad + (i / (points.length - 1 || 1)) * (w - pad - 15)},${12 + (1 - v / max) * (h - 50)}`,
    )
    .join(" ");
  const area = path + ` L${w - 15},${h - 38} L${pad},${h - 38} Z`;
  return (
    <div className="balance-chart">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        role="img"
        aria-label={`Proyección del capital desde ${usd(opening)} hasta cero en ${f.payments} pagos`}
      >
        <defs>
          <linearGradient id="balance-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-line)" stopOpacity=".20" />
            <stop
              offset="100%"
              stopColor="var(--chart-line)"
              stopOpacity=".015"
            />
          </linearGradient>
        </defs>
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line
              x1={pad}
              x2={w - 15}
              y1={12 + t * (h - 50)}
              y2={12 + t * (h - 50)}
              stroke="var(--line)"
              strokeDasharray="4 5"
            />
            <text x="0" y={16 + t * (h - 50)} fill="var(--muted)" fontSize="11">
              ${Math.round(((1 - t) * opening) / 10000) / 10}k
            </text>
          </g>
        ))}
        <path d={area} fill="url(#balance-fill)" />
        <path
          d={path}
          fill="none"
          stroke="var(--chart-line)"
          strokeWidth="2.6"
        />
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const i = Math.round(t * (f.schedule.length - 1));
          return (
            <text
              key={t}
              x={pad + t * (w - pad - 15)}
              y={h - 9}
              textAnchor={t === 1 ? "end" : t === 0 ? "start" : "middle"}
              fill="var(--muted)"
              fontSize="11"
            >
              {f.schedule[i]?.period || "—"}
            </text>
          );
        })}
      </svg>
    </div>
  );
}
function Movements({
  d,
  open,
  edit,
  onSaved,
}: {
  d: Snapshot;
  open: (k: "bank" | "contribution" | "cash" | "statement") => void;
  edit: (e: Edit) => void;
  onSaved: () => Promise<void>;
}) {
  const [tab, setTab] = useState<"bank" | "contribution" | "cash">("bank"),
    [query, setQuery] = useState("");
  const rows =
    tab === "bank"
      ? d.rawMovements
      : tab === "contribution"
        ? d.contributions
        : d.cash;
  const filtered = rows.filter((r) =>
    JSON.stringify([
      r.date,
      r.period,
      r.notes,
      r.concept,
      r.contributor,
      typeNames[r.type || r.kind],
    ])
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <>
      <div className="tab-row">
        <div className="tabs">
          <button
            className={tab === "bank" ? "active" : ""}
            onClick={() => setTab("bank")}
          >
            Pagos al banco
          </button>
          <button
            className={tab === "contribution" ? "active" : ""}
            onClick={() => setTab("contribution")}
          >
            Aportes recibidos
          </button>
          <button
            className={tab === "cash" ? "active" : ""}
            onClick={() => setTab("cash")}
          >
            Caja personal
          </button>
        </div>
        <button className="button secondary" onClick={() => open(tab)}>
          <Plus size={16} />
          {tab === "contribution"
            ? "Registrar aporte"
            : tab === "cash"
              ? "Registrar caja"
              : "Registrar pago"}
        </button>
      </div>
      <div className="notice">
        <Info size={17} />
        {tab === "bank"
          ? "Los pagos regulares cubren interés, FECI y otros cargos pendientes; el remanente reduce capital. Los extras se aplican al destino elegido."
          : tab === "contribution"
            ? "Recibir dinero no registra un pago al banco. Vincula después el aporte con su aplicación bancaria para evitar duplicados."
            : "Registra la planilla efectivamente recibida, neta del descuento BG. Los pagos regulares de planilla no se descuentan otra vez de esta caja."}
      </div>
      <section className="panel">
        <div className="panel-heading">
          <h2>
            {tab === "bank"
              ? "Movimientos bancarios"
              : tab === "contribution"
                ? "Aportes y reembolsos"
                : "Movimientos de caja"}
          </h2>
          <label className="search-input">
            <Search size={16} />
            <input
              aria-label="Buscar movimientos"
              placeholder="Buscar movimiento…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </div>
        {!filtered.length ? (
          <Empty
            title="Todavía no hay movimientos"
            text="Registra el primero cuando ocurra. El interés cotizado y el historial anterior no son pagos del préstamo nuevo."
            action={() => open(tab)}
          />
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Fecha / período</th>
                  <th>
                    {tab === "contribution" ? "Persona y origen" : "Movimiento"}
                  </th>
                  <th>Importe</th>
                  <th>
                    {tab === "bank"
                      ? "Capital aplicado"
                      : tab === "contribution"
                        ? "Sin aplicar"
                        : "Concepto"}
                  </th>
                  <th>Estado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const app = d.real.applications.find((x) => x.id === r.id);
                  const receivedApplied =
                    d.cashCompensations
                      .filter(
                        (x) =>
                          x.status === "active" && x.contribution_id === r.id,
                      )
                      .reduce(
                        (s, x) => s + Math.round(Number(x.amount) * 100),
                        0,
                      ) +
                    d.links
                      .filter((l) => l.contribution_id === r.id)
                      .reduce(
                        (s, l) => s + Math.round(Number(l.amount) * 100),
                        0,
                      );
                  return (
                    <tr
                      key={r.id}
                      className={r.status === "void" ? "void-row" : ""}
                    >
                      <td>
                        <strong>{displayDate(r.date)}</strong>
                        <small>{r.period}</small>
                      </td>
                      <td>
                        <strong>
                          {tab === "contribution"
                            ? r.contributor
                            : typeNames[r.type || r.kind]}
                        </strong>
                        <small>
                          {tab === "contribution"
                            ? names[r.source_id as Source]
                            : r.notes || r.concept || "Sin observaciones"}
                        </small>
                      </td>
                      <td className="money">
                        {usd(Math.round(Number(r.amount) * 100))}
                      </td>
                      <td className="money">
                        {tab === "bank"
                          ? usd(app?.principal || 0)
                          : tab === "contribution"
                            ? usd(
                                Math.round(Number(r.amount) * 100) -
                                  receivedApplied,
                              )
                            : r.concept}
                      </td>
                      <td>
                        <span
                          className={
                            "tag " + (r.status === "void" ? "muted" : "success")
                          }
                        >
                          {r.status === "void" ? "Anulado" : "Real"}
                        </span>
                      </td>
                      <td>
                        {r.status === "active" && (
                          <button
                            className="text-button"
                            onClick={() => edit({ kind: tab, record: r })}
                          >
                            Corregir
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
      {tab === "contribution" && <CashCompensations d={d} onSaved={onSaved} />}
      {tab === "bank" && d.real.applications.length > 0 && (
        <section className="panel section-gap">
          <div className="panel-heading">
            <h2>Aplicaciones y compensaciones</h2>
            <a className="text-button" href="/api/export?kind=allocations">
              <Download size={15} />
              CSV
            </a>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Período / tipo</th>
                  <th>Capital</th>
                  <th>Interés / FECI</th>
                  <th>Otros pagados</th>
                  <th>Adelanto Javier</th>
                  <th>Compensación</th>
                  <th>Exceso</th>
                </tr>
              </thead>
              <tbody>
                {d.real.applications.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <strong>{a.period}</strong>
                      <small>{typeNames[a.type]}</small>
                    </td>
                    <td>{usd(a.principal)}</td>
                    <td>
                      {usd(a.interest)} / {usd(a.feci)}
                    </td>
                    <td>{usd(a.other)}</td>
                    <td>{usd(a.advance)}</td>
                    <td>{usd(a.compensation)}</td>
                    <td>{usd(a.excess)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <div className="export-links">
        <a
          href={
            "/api/export?kind=" +
            {
              bank: "movements",
              contribution: "contributions",
              cash: "budget",
            }[tab]
          }
        >
          <Download size={15} />
          Exportar esta lista CSV
        </a>
        <button onClick={() => open("statement")}>
          Ingresar datos del extracto <ArrowRight size={15} />
        </button>
      </div>
      {d.real.warnings.map((w, i) => (
        <p className="warning" key={i}>
          <AlertCircle size={17} />
          {w}
        </p>
      ))}
    </>
  );
}
function Sources({
  d,
  selected,
  setSelected,
}: {
  d: Snapshot;
  selected: Source;
  setSelected: (s: Source) => void;
}) {
  const s = selected,
    b = d.real.bags[s],
    f = d.current.sections[s];
  return (
    <>
      <div className="source-grid">
        {(Object.keys(initial) as Source[]).map((s) => (
          <SourceCard key={s} s={s} d={d} onClick={() => setSelected(s)} />
        ))}
      </div>
      <section className="panel section-gap">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">RESPONSABILIDAD INTERNA</span>
            <h2>{names[s]}</h2>
          </div>
          <span className={"source-icon " + s}>{initials[s]}</span>
        </div>
        <div className="detail-grid">
          <div>
            <small>Capital inicial</small>
            <strong>{usd(initial[s])}</strong>
          </div>
          <div>
            <small>Capital amortizado</small>
            <strong>{usd(b.amortized)}</strong>
          </div>
          <div>
            <small>Interés pagado / pendiente</small>
            <strong>
              {usd(b.paidInterest)} / {usd(b.interest)}
            </strong>
          </div>
          <div>
            <small>FECI pagado / pendiente</small>
            <strong>
              {usd(b.paidFeci)} / {usd(b.feci)}
            </strong>
          </div>
          <div>
            <small>Otros pagados / pendientes</small>
            <strong>
              {usd(b.paidOther)} / {usd(b.other)}
            </strong>
          </div>
          <div>
            <small>Liquidación real</small>
            <strong>{displayDate(b.closedOn)}</strong>
          </div>
          <div>
            <small>Liquidación proyectada</small>
            <strong>{displayDate(f.closeDate)}</strong>
          </div>
          <div>
            <small>Límite interno</small>
            <strong>
              {f.deadline ? displayDate(f.deadline) : "Sin límite separado"}
            </strong>
          </div>
        </div>
        {f.remainingAtDeadline > 0 && (
          <p className="warning">
            {s === "credi"
              ? "ERROR: CREDIJAMAR DEBE ESTAR LIQUIDADO EN 24 MESES"
              : "Chunky no cumple la fecha límite en la proyección."}{" "}
            Faltante al límite: {usd(f.remainingAtDeadline)}. Extra dirigido
            ahora estimado: {usd(f.extraNow)}. Cargos y compensaciones
            pendientes se conservan por separado.
          </p>
        )}
        <p className="notice">
          <Info size={17} />
          Interés y FECI legales se calculan una sola vez por período y se
          atribuyen según el capital inicial de cada bolsa. Las cuotas regulares
          son fijas; el capital de Javier se divide entre tarjetas y costos
          según sus saldos.
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Período / movimiento</th>
                <th>Capital aplicado</th>
                <th>Interés pagado</th>
                <th>FECI pagado</th>
                <th>Compensación</th>
              </tr>
            </thead>
            <tbody>
              {d.real.applications
                .filter((a) =>
                  a.allocations.some(
                    (x) =>
                      x.source === s &&
                      (x.principal || x.interest || x.feci || x.other),
                  ),
                )
                .map((a) => {
                  const x = a.allocations.find((x) => x.source === s)!;
                  return (
                    <tr key={a.id}>
                      <td>
                        <strong>{a.period}</strong>
                        <small>{typeNames[a.type]}</small>
                      </td>
                      <td>{usd(x.principal)}</td>
                      <td>{usd(x.interest)}</td>
                      <td>{usd(x.feci)}</td>
                      <td>{usd(x.compensation)}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
          {!d.real.applications.length && (
            <p className="empty-inline">
              Sin pagos reales. Los saldos iniciales se conservan completos.
            </p>
          )}
        </div>
      </section>
      <section className="panel section-gap">
        <div className="panel-heading">
          <h2>Calendario interno de {names[s]}</h2>
          <span className="tag">Proyección mensual</span>
        </div>
        <div className="table-scroll max-height">
          <table>
            <thead>
              <tr>
                <th>Período</th>
                <th>Capital inicial</th>
                <th>Interés atribuido</th>
                <th>FECI atribuido</th>
                <th>Capital amortizado</th>
                <th>Capital final</th>
                <th>Cargos pendientes</th>
              </tr>
            </thead>
            <tbody>
              {d.current.schedule
                .filter(
                  (r) =>
                    r.sources &&
                    (r.sources[s].opening ||
                      r.sources[s].pendingInterest ||
                      r.sources[s].pendingFeci),
                )
                .map((r) => {
                  const x = r.sources![s];
                  return (
                    <tr key={r.period}>
                      <td>{r.period}</td>
                      <td>{usd(x.opening)}</td>
                      <td>{usd(x.interest)}</td>
                      <td>{usd(x.feci)}</td>
                      <td>{usd(x.principal)}</td>
                      <td>{usd(x.closing)}</td>
                      <td>
                        {usd(
                          x.pendingInterest + x.pendingFeci + x.pendingOther,
                        )}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
        <p className="fine-print">
          Se respetan las cuotas fijas y los límites. Este calendario no
          registra pagos reales. CrediJamar amortiza su propio capital; la parte
          aplicada a Javier por compensación se muestra en Movimientos.
        </p>
      </section>
      {s === "credi" && <CrediComparison d={d} />}
      {s === "chunky" && (
        <div className="notice section-gap">
          <Info size={17} />
          Préstamo anterior: app {usd(695649)}, consolidado {usd(702434)},
          diferencia {usd(6785)} de concepto desconocido. El historial anterior
          ({usd(151296)}) se consulta en Historial y no reduce este capital
          nuevo.
        </div>
      )}
      {(s === "cards" || s === "costs") && (
        <section className="panel section-gap">
          <div className="panel-heading">
            <h2>Composición inicial</h2>
          </div>
          {d.composition
            .filter((x) => x.source_id === s)
            .map((x) => (
              <div className="composition-line" key={x.id}>
                <span>
                  {x.concept}
                  {x.kind === "cash" && (
                    <small> Efectivo recibido, no gasto</small>
                  )}
                </span>
                <strong>{usd(Math.round(Number(x.amount) * 100))}</strong>
              </div>
            ))}
        </section>
      )}
    </>
  );
}
function CrediComparison({ d }: { d: Snapshot }) {
  const r = d.crediReference;
  return (
    <section className="panel section-gap">
      <div className="panel-heading">
        <h2>CrediJamar, en sus propios números</h2>
        <span className="tag">Comparación aislada · 24 meses</span>
      </div>
      <div className="comparison-grid">
        <div>
          <span className="eyebrow">ESCENARIO ORIGINAL</span>
          <h3>{usd(r.original)}</h3>
          <p>24 cuotas estimadas de $97.00</p>
          <small>
            {usd(r.implicitCost)} de costo financiero implícito estimado. No se
            conoce su tasa ni el desglose.
          </small>
        </div>
        <div>
          <span className="eyebrow">REFERENCIA BG</span>
          <h3>{usd(r.total)}</h3>
          <p>{usd(r.charges)} de interés + FECI estimados</p>
          <small>
            Cuota precisa ${r.exact}; propuesta $62.56. Última cuota aislada
            aproximada {usd(r.last)}.
          </small>
        </div>
        <div className="saving-callout">
          <TrendingDown size={23} />
          <strong>{usd(r.saving)}</strong>
          <span>Menor costo financiero estimado</span>
          <small>
            Únicamente sobre $1,349 a 24 meses. No incluye gastos generales ni
            representa ahorro de todo BG.
          </small>
        </div>
      </div>
      <p className="fine-print">
        La referencia aislada conserva precisión completa. Las asignaciones
        reales del préstamo legal se redondean a centavos con reparto por
        mayores residuos, por lo que el último importe interno puede variar
        algunos centavos.
      </p>
    </section>
  );
}
function Projections({ d }: { d: Snapshot }) {
  const next =
      d.current.schedule[0]?.period || d.parameters.firstDue.slice(0, 7),
    [amount, setAmount] = useState("200.00"),
    [source, setSource] = useState<Source>("cards"),
    [result, setResult] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function run(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period: next, source, amount }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setResult(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al simular.");
    } finally {
      setBusy(false);
    }
  }
  const impact = d.lastImpact,
    off = (() => {
      const dt = new Date(d.versions[0].firstDue + "T12:00:00Z");
      dt.setUTCMonth(dt.getUTCMonth() + 83);
      return dt.toISOString().slice(0, 10);
    })();
  return (
    <>
      <div className="notice">
        <Info size={17} />
        Proyecciones mensuales completas con interés{" "}
        {Number(d.parameters.interest) * 100}% y FECI{" "}
        {Number(d.parameters.feci) * 100}% anuales. El 11.72% es la tasa
        efectiva reportada, no la tasa usada para forzar los 84 meses.
      </div>
      <div className="scenario-grid">
        {[
          {
            title: "Solo cuota regular",
            f: d.regular,
            note: "Referencia legal desde el inicio · $317.60",
          },
          {
            title: "Plan habitual",
            f: d.habitual,
            note: "Si haces abonos voluntarios mensuales a CrediJamar",
          },
          {
            title: "Trayectoria actual",
            f: d.current,
            note: "Pagos registrados + abonos voluntarios futuros supuestos",
          },
        ].map((x, i) => (
          <section
            className={"panel scenario " + (i === 2 ? "selected" : "")}
            key={x.title}
          >
            <span className="eyebrow">ESCENARIO {i + 1}</span>
            <h2>{x.title}</h2>
            <strong className="scenario-number">
              {x.f.payments}
              <small>pagos {i === 2 ? "restantes" : "proyectados"}</small>
            </strong>
            <p>{displayDate(x.f.closeDate)}</p>
            <div className="scenario-charges">
              <span>Interés + FECI {i === 2 ? "futuros" : "totales"}</span>
              <strong>{usd(x.f.interest + x.f.feci)}</strong>
            </div>
            <small>{x.note}</small>
          </section>
        ))}
      </div>
      <section className="panel section-gap">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">
              VARIACIÓN DEL TIEMPO POR ABONOS A CAPITAL
            </span>
            <h2>El plazo, con referencias claras</h2>
          </div>
          <TrendingDown size={23} />
        </div>
        <div className="detail-grid">
          <div>
            <small>Plazo oficial</small>
            <strong>84 meses</strong>
          </div>
          <div>
            <small>Plazo matemático base</small>
            <strong>{d.regular.payments} pagos</strong>
          </div>
          <div>
            <small>Restante sin extras</small>
            <strong>{d.baseRemaining.payments} pagos</strong>
          </div>
          <div>
            <small>Restante actual</small>
            <strong>{d.current.payments} pagos</strong>
          </div>
          <div>
            <small>Meses ahorrados proyectados</small>
            <strong>
              {d.accumulated.months} ({Math.floor(d.accumulated.months / 12)}{" "}
              años, {d.accumulated.months % 12} meses)
            </strong>
          </div>
          <div>
            <small>Fecha oficial provisional</small>
            <strong>{displayDate(off)}</strong>
          </div>
          <div>
            <small>Fecha matemática base</small>
            <strong>{displayDate(d.regular.closeDate)}</strong>
          </div>
          <div>
            <small>Fecha actual estimada</small>
            <strong>{displayDate(d.current.closeDate)}</strong>
          </div>
          <div>
            <small>Extraordinario realmente aplicado</small>
            <strong>{usd(d.real.extraPrincipal)}</strong>
          </div>
          <div>
            <small>Ahorro proyectado por CrediJamar</small>
            <strong>{usd(d.accumulated.credi)}</strong>
          </div>
          <div>
            <small>Ahorro proyectado por otros abonos</small>
            <strong>{usd(d.accumulated.voluntary)}</strong>
          </div>
          <div>
            <small>Ahorro acumulado de la trayectoria</small>
            <strong>{usd(d.accumulated.total)}</strong>
          </div>
        </div>
        <p className="fine-print">
          Referencia: mismos pagos regulares observados, completados con cuotas
          futuras. Se comparan trayectorias completas: solo regular, regular +
          abonos voluntarios CrediJamar y pagos reales + plan. Los abonos
          futuros son una hipótesis; no se registran pagos automáticamente. El
          ahorro incluye cargos futuros estimados y no suma el capital abonado.
          La diferencia inicial entre 84 y {d.regular.payments} pagos no es
          ahorro por abonos. Con extractos, sus devengos confirmados se
          mantienen iguales en el historial contrafactual.
        </p>
      </section>
      <div className="bottom-grid section-gap">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">SIMULACIÓN HIPOTÉTICA</span>
              <h2>¿Y si abono un poco más?</h2>
            </div>
            <span className="tag">No registra pagos</span>
          </div>
          <form onSubmit={run} className="simulation-form">
            <label>
              Abono a capital (USD)
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
            <label>
              Destino explícito
              <select
                value={source}
                onChange={(e) => setSource(e.target.value as Source)}
              >
                {Object.keys(names).map((s) => (
                  <option key={s} value={s}>
                    {names[s as Source]}
                  </option>
                ))}
              </select>
            </label>
            <div className="preset-row">
              {[200, 1000, 500].map((n) => (
                <button
                  type="button"
                  key={n}
                  onClick={() => setAmount(n.toFixed(2))}
                >
                  ${n}
                </button>
              ))}
            </div>
            <p className="fine-print">
              Se aplicaría después de los pagos previstos de {next}. Las cuotas
              bancarias futuras de CrediJamar se mantienen iguales en ambos
              contrafactuales para aislar el efecto de este extra.
            </p>
            <button className="button primary" disabled={busy}>
              {busy ? "Calculando…" : "Calcular impacto"}
              <ArrowRight size={17} />
            </button>
          </form>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {result && (
            <div className="simulation-result">
              <div>
                <small>Meses menos</small>
                <strong>{result.months}</strong>
              </div>
              <div>
                <small>Interés + FECI evitados</small>
                <strong>{usd(result.saving)}</strong>
              </div>
              <div>
                <small>Cierre con abono</small>
                <strong>{displayDate(result.with.closeDate)}</strong>
              </div>
              <p>
                Sin abono: {result.without.payments} pagos · Con abono:{" "}
                {result.with.payments}. Cargos futuros:{" "}
                {usd(result.without.interest + result.without.feci)} →{" "}
                {usd(result.with.interest + result.with.feci)}.
              </p>
              {result.excess > 0 && (
                <p className="warning">
                  Exceso estimado: {usd(result.excess)}. Requiere destino nuevo
                  explícito.
                </p>
              )}
            </div>
          )}
        </section>
        <section className="panel">
          <div className="panel-heading">
            <h2>Impacto del último abono</h2>
            <ArrowUpRight size={20} />
          </div>
          {impact ? (
            <>
              <div className="detail-grid">
                <div>
                  <small>Capital sin / con abono</small>
                  <strong>
                    {usd(impact.withoutCapital)} / {usd(impact.withCapital)}
                  </strong>
                </div>
                <div>
                  <small>Pagos sin / con</small>
                  <strong>
                    {impact.without.payments} / {impact.with.payments}
                  </strong>
                </div>
                <div>
                  <small>Meses menos</small>
                  <strong>{impact.months}</strong>
                </div>
                <div>
                  <small>Ahorro de cargos futuros</small>
                  <strong>{usd(impact.saving)}</strong>
                </div>
                <div>
                  <small>Cierre sin abono</small>
                  <strong>{displayDate(impact.without.closeDate)}</strong>
                </div>
                <div>
                  <small>Cierre con abono</small>
                  <strong>{displayDate(impact.with.closeDate)}</strong>
                </div>
              </div>
              <p className="fine-print">
                Mismos pagos regulares y mismos aportes futuros de CrediJamar.
                Ahorro individual; no se suma mecánicamente a otros ahorros.
              </p>
            </>
          ) : (
            <Empty
              title="Tu primer extra empieza aquí"
              text="Cuando registres un abono real, verás su efecto individual sobre el plazo y los cargos futuros."
            />
          )}
        </section>
      </div>
      {d.current.warnings.map((w) => (
        <p key={w} className="warning">
          {w}
        </p>
      ))}
      <section className="panel section-gap">
        <div className="panel-heading">
          <h2>Calendario proyectado</h2>
          <a className="text-button" href="/api/export?kind=projection">
            <Download size={16} />
            Exportar proyección
          </a>
        </div>
        <div className="table-scroll max-height">
          <table>
            <thead>
              <tr>
                <th>Fecha estimada</th>
                <th>Capital inicial</th>
                <th>Interés</th>
                <th>FECI</th>
                <th>Regular</th>
                <th>CrediJamar</th>
                <th>Capital final</th>
              </tr>
            </thead>
            <tbody>
              {d.current.schedule.map((x) => (
                <tr key={x.period}>
                  <td>{displayDate(x.date)}</td>
                  <td>{usd(x.opening)}</td>
                  <td>{usd(x.interest)}</td>
                  <td>{usd(x.feci)}</td>
                  <td>{usd(x.regular)}</td>
                  <td>{usd(x.credi)}</td>
                  <td>{usd(x.closing)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <CrediComparison d={d} />
    </>
  );
}
function Budget({ d, open }: { d: Snapshot; open: () => void }) {
  const [period, setPeriod] = useState(d.initialBudget.period),
    [half, setHalf] = useState("1"),
    [b, setB] = useState(d.initialBudget),
    [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    fetch(`/api/budget?period=${encodeURIComponent(period)}&half=${half}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error);
        setB(j);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => controller.abort();
  }, [period, half, d]);
  const {
    gross,
    regular,
    chunky,
    load,
    net,
    distribution,
    room,
    income,
    reimb,
    spent,
    saving,
    extras,
    myPercent,
    myCredi,
  } = b;

  return (
    <>
      <div className="tab-row">
        <div>
          <label className="inline-label">
            Período
            <input
              type="month"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
            />
          </label>
        </div>
        <div className="tabs">
          <button
            onClick={() => setHalf("1")}
            className={half === "1" ? "active" : ""}
          >
            1.ª quincena
          </button>
          <button
            onClick={() => setHalf("2")}
            className={half === "2" ? "active" : ""}
          >
            2.ª quincena
          </button>
          <button
            onClick={() => setHalf("all")}
            className={half === "all" ? "active" : ""}
          >
            Mes completo
          </button>
        </div>
        <button className="button secondary" onClick={open}>
          <Plus size={16} />
          Registrar caja
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="metrics-grid">
        <Metric
          label="Planilla esperada"
          value={usd(net)}
          note={
            b.salaryIncludesLoan
              ? "Salario ya incluye descuento BG"
              : "Salario indicado menos descuento BG"
          }
          icon={Banknote}
        />
        <Metric
          label="Chunky esperado"
          value={usd(chunky)}
          note="Todavía no es efectivo recibido"
          icon={Clock3}
        />
        <Metric
          label="Aportes recibidos"
          value={usd(reimb)}
          note="Reembolso / fondos recibidos, no salario"
          icon={ArrowDownLeft}
        />
        <Metric
          label="Caja real registrada"
          value={usd(b.actualCash)}
          note="Disponible registrado, sin saldo previo"
          icon={Wallet}
        />
      </div>
      <div className="main-grid">
        <section className="panel">
          <div className="panel-heading">
            <h2>Tu flujo esperado</h2>
            <span className="tag">Hipótesis visible</span>
          </div>
          <div className="composition-line">
            <span>
              Salario{" "}
              {b.salaryIncludesLoan ? "neto indicado" : "antes del préstamo"}
            </span>
            <strong>{usd(gross)}</strong>
          </div>
          <div className="composition-line">
            <span>
              Descuento BG{" "}
              {b.salaryIncludesLoan ? "(incluido, sin descontar otra vez)" : ""}
            </span>
            <strong>{usd(regular)}</strong>
          </div>
          <div className="composition-line">
            <span>Recibido esperado de planilla</span>
            <strong>{usd(net)}</strong>
          </div>
          <div className="composition-line">
            <span>Reembolso esperado de Chunky</span>
            <strong>+ {usd(chunky)}</strong>
          </div>
          <div className="budget-total">
            <span>Después de recibir ese reembolso</span>
            <strong>{usd(b.availableAfterExpected)}</strong>
          </div>
          <p className="notice">
            <Info size={17} />
            La caja real solo incorpora planilla neta registrada y aportes
            recibidos, resta extras bancarios, gastos de caja y ahorro separado.
            Los gastos desde ahorros acumulados solo reducen el saldo de ahorro.
            El descuento regular de planilla no se resta otra vez. No incluye un
            saldo inicial de efectivo desconocido.
          </p>
          <div className="detail-grid">
            <div>
              <small>Ingresos netos registrados</small>
              <strong>{usd(income)}</strong>
              {b.extraIncome > 0 && (
                <small>
                  Incluye {usd(b.extraIncome)} de ingresos extra en Mis totales
                </small>
              )}
            </div>
            <div>
              <small>Gastos de caja registrados</small>
              <strong>{usd(spent)}</strong>
            </div>
            <div>
              <small>Extras pagados BG</small>
              <strong>{usd(extras)}</strong>
            </div>
            <div>
              <small>Ahorro líquido separado</small>
              <strong>{usd(saving)}</strong>
            </div>
          </div>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <h2>Referencia 50 / 30 / 20</h2>
            <Wallet size={20} />
          </div>
          {distribution.map((x) => (
            <div className="budget-category" key={x.name}>
              <span className={"dot " + x.color} />
              <div>
                <strong>{x.name}</strong>
                <small>{x.percent}% de salario antes del préstamo</small>
              </div>
              <strong>{usd(x.amount)}</strong>
            </div>
          ))}
          <div className="composition-line">
            <span>Tu carga regular personal</span>
            <strong>{usd(load)}</strong>
          </div>
          <div className="budget-total">
            <span>Para CrediJamar, ahorro o extras</span>
            <strong>{usd(room)}</strong>
          </div>
          <p className="fine-print">
            Responsabilidad CrediJamar:{" "}
            {myCredi === null
              ? "sin configurar; no se presume 50/50."
              : `${myPercent}% Javier, ${usd(myCredi)} en este período.`}{" "}
            Configúrala por persona en Ajustes.
          </p>
          <div className="scenario-note">
            <strong>Escenario: Javier cubre toda CrediJamar</strong>
            <p>
              CrediJamar: {usd(b.scenarioCredi)} · Ahorro líquido posible:{" "}
              {usd(b.scenarioLiquid)}.
            </p>
            <small>
              Es una hipótesis, no un reparto confirmado ni efectivo disponible.
            </small>
          </div>
        </section>
      </div>
      <BudgetCategories b={b} />
      <section className="panel section-gap">
        <div className="panel-heading">
          <h2>Aportes: esperado, recibido y pendiente</h2>
        </div>
        {b.contributions.map((x) => (
          <div className="composition-line" key={x.source}>
            <span>{names[x.source]}</span>
            <span>
              {x.source === "credi" ? "Referencia voluntaria" : "Esperado"}{" "}
              {usd(x.expected)} · Recibido {usd(x.received)} ·
              {x.source === "credi" ? "Diferencia con referencia" : "Pendiente"}{" "}
              {usd(x.pending)}
            </span>
          </div>
        ))}
        <p className="fine-print">
          Aportes por período de responsabilidad; caja por fecha efectiva de
          recepción. Los importes recibidos no prueban su aplicación al banco.
          Las responsabilidades configuradas no crean movimientos reales.
          CrediJamar es voluntario; la referencia mensual no es un pago
          realizado.
        </p>
      </section>
    </>
  );
}
function Controls({ d, open }: { d: Snapshot; open: () => void }) {
  return (
    <>
      <div className="metrics-grid">
        <Metric
          label="Controles correctos"
          value={String(d.controls.filter((x) => x.status === "pass").length)}
          note="Cuadres financieros verificables"
          icon={CheckCircle2}
        />
        <Metric
          label="Por revisar"
          value={String(d.controls.filter((x) => x.status === "fail").length)}
          note="Diferencias visibles, sin ajustes automáticos"
          icon={AlertCircle}
        />
        <Metric
          label="Datos pendientes"
          value={String(
            d.controls.filter((x) => x.status === "pending").length,
          )}
          note="No se reemplazan por ceros"
          icon={Clock3}
        />
        <Metric
          label="Compensación pendiente"
          value={usd(d.real.advance)}
          note="Deuda interna separada del capital"
          icon={Wallet}
        />
      </div>
      <section className="panel">
        <div className="panel-heading">
          <h2>Controles de cuadre</h2>
          <button className="button secondary" onClick={open}>
            <Plus size={16} />
            Ingresar extracto
          </button>
        </div>
        <div className="control-list">
          {d.controls.map((c) => (
            <div className="control-row" key={c.id}>
              <span className={"control-status " + c.status}>
                {c.status === "pass" ? (
                  <Check size={17} />
                ) : c.status === "fail" ? (
                  <AlertCircle size={17} />
                ) : (
                  <Clock3 size={17} />
                )}
              </span>
              <div>
                <strong>
                  {String(c.id).padStart(2, "0")} · {c.label}
                </strong>
                <p>{c.explanation}</p>
              </div>
              <strong className="control-amount">
                {c.amount === null ? "Pendiente" : usd(c.amount)}
              </strong>
            </div>
          ))}
        </div>
      </section>
      <section className="panel section-gap">
        <div className="panel-heading">
          <h2>Devengado, aplicado y reportado por período</h2>
          <a className="text-button" href="/api/export?kind=results">
            <Download size={16} />
            CSV
          </a>
        </div>
        {!d.real.periods.length ? (
          <p className="empty-inline">
            El préstamo nuevo todavía no tiene períodos vencidos ni movimientos
            registrados.
          </p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Período</th>
                  <th>Registro</th>
                  <th>Interés / FECI devengado</th>
                  <th>Capital aplicado</th>
                  <th>Calculado</th>
                  <th>Reportado</th>
                  <th>Diferencia saldo</th>
                  <th>Diferencia capital</th>
                </tr>
              </thead>
              <tbody>
                {d.real.periods.map((x) => (
                  <tr key={x.period}>
                    <td>
                      {x.period}
                      <small>
                        {x.confirmed
                          ? "Extracto parcial/confirmado"
                          : "Estimado sin extracto"}
                      </small>
                    </td>
                    <td>
                      {x.status === "unknown"
                        ? "Desconocido"
                        : x.status === "no-payment"
                          ? "Sin pago confirmado"
                          : "Movimientos reales"}
                    </td>
                    <td>
                      {usd(x.interest)} / {usd(x.feci)}
                    </td>
                    <td>{usd(x.principal)}</td>
                    <td>{usd(x.closing)}</td>
                    <td>
                      {x.bankBalance === null
                        ? "Desconocido"
                        : usd(x.bankBalance)}
                    </td>
                    <td>
                      {x.balanceDifference === null
                        ? "—"
                        : usd(x.balanceDifference)}
                    </td>
                    <td>
                      {x.principalDifference === null
                        ? "—"
                        : usd(x.principalDifference)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
function HistoryView({ d }: { d: Snapshot }) {
  return (
    <>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">
              PRÉSTAMO ANTERIOR · NO SUMA AL NUEVO BG
            </span>
            <h2>Historial de Chunky Bites</h2>
          </div>
          <strong>{usd(151296)}</strong>
        </div>
        <div className="detail-grid">
          <div>
            <small>Capital original</small>
            <strong>$7,800.00</strong>
          </div>
          <div>
            <small>Tasa / FECI anual</small>
            <strong>9.25% / 1%</strong>
          </div>
          <div>
            <small>Mensualidad</small>
            <strong>$171.24</strong>
          </div>
          <div>
            <small>Desembolso</small>
            <strong>19/11/2025</strong>
          </div>
          <div>
            <small>Vencimiento original</small>
            <strong>02/06/2031</strong>
          </div>
          <div>
            <small>Último pago conocido</small>
            <strong>07/09/2026</strong>
          </div>
          <div>
            <small>Método</small>
            <strong>Descuento directo</strong>
          </div>
          <div>
            <small>Diferencia app / cancelación</small>
            <strong>$67.85 · Concepto desconocido</strong>
          </div>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Mes</th>
                <th>Pago conocido</th>
                <th>Capital / interés / FECI</th>
              </tr>
            </thead>
            <tbody>
              {d.history.map((x) => (
                <tr key={x.period}>
                  <td>{x.period}</td>
                  <td>{usd(Math.round(Number(x.payment) * 100))}</td>
                  <td>Desglose desconocido</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel section-gap">
        <div className="panel-heading">
          <h2>Auditoría de cambios</h2>
          <span className="tag">Últimos 100 registros</span>
        </div>
        {d.audit.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Fecha Panamá</th>
                  <th>Entidad</th>
                  <th>Acción</th>
                  <th>Motivo / detalle</th>
                </tr>
              </thead>
              <tbody>
                {d.audit.map((x) => (
                  <tr key={x.id}>
                    <td>
                      {new Intl.DateTimeFormat("es-PA", {
                        timeZone: "America/Panama",
                        dateStyle: "short",
                        timeStyle: "short",
                      }).format(new Date(x.created_at))}
                    </td>
                    <td>
                      {x.entity}
                      <small>{x.entity_id}</small>
                    </td>
                    <td>{x.action}</td>
                    <td>
                      {x.reason}
                      <details>
                        <summary>Ver cambio</summary>
                        <pre>
                          {JSON.stringify(
                            { antes: x.before_data, después: x.after_data },
                            null,
                            2,
                          )}
                        </pre>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty-inline">
            Sin modificaciones. Los datos iniciales se conservan tal como fueron
            proporcionados.
          </p>
        )}
      </section>
    </>
  );
}
function Empty({
  title,
  text,
  action,
}: {
  title: string;
  text: string;
  action?: () => void;
}) {
  return (
    <div className="empty-state">
      <span>
        <ReceiptText size={26} />
      </span>
      <h3>{title}</h3>
      <p>{text}</p>
      {action && (
        <button className="button secondary" onClick={action}>
          <Plus size={16} />
          Registrar movimiento
        </button>
      )}
    </div>
  );
}
