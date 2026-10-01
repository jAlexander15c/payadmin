import { NextResponse } from "next/server";
import { z } from "zod";
import { checkOrigin, HttpError, login, logout, requireUser } from "@/lib/auth";
import {
  createRecord,
  createCashCompensation,
  correctCashCompensation,
  correctRecord,
  saveParameters,
  saveResponsibilities,
  saveStatement,
  confirmFirstDate,
  snapshot,
  saveFixedExpense,
  adjustFund,
} from "@/lib/store";
import { period, simulationInput } from "@/lib/validation";
import { budgetFor } from "@/lib/budget";
import { fundEffect, fundEffectNames } from "@/lib/funds";
import { cents, money, simulate } from "@/lib/finance";
import { registerInitialUser } from "@/lib/initial-registration";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ path: string[] }> };
function response(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
function failure(e: unknown) {
  if (e instanceof HttpError) return response({ error: e.message }, e.status);
  if (e instanceof z.ZodError)
    return response({ error: e.issues.map((x) => x.message).join(" ") }, 400);
  console.error("Operación fallida:", e instanceof Error ? e.name : "Error");
  return response(
    {
      error:
        "No se pudo completar la operación. Comprueba PostgreSQL y la configuración del servidor.",
    },
    503,
  );
}
async function body(req: Request) {
  const text = await req.text();
  if (text.length > 20000)
    throw new HttpError(413, "Solicitud demasiado grande.");
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "JSON inválido.");
  }
}
export function csvCell(v: unknown) {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[\s]*[=+\-@]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
export async function GET(req: Request, ctx: Context) {
  try {
    await requireUser();
    const path = (await ctx.params).path.join("/");
    const data = await snapshot();
    if (path === "snapshot") return response(data);
    if (path === "budget") {
      const url = new URL(req.url),
        p = period.parse(url.searchParams.get("period")),
        half = z.enum(["1", "2", "all"]).parse(url.searchParams.get("half"));
      return response(budgetFor(data, p, half));
    }
    if (path === "export") {
      const kind = new URL(req.url).searchParams.get("kind") || "movements";
      let rows: unknown[][];
      if (kind === "results")
        rows = [
          [
            "Período",
            "Estado",
            "Capital inicial USD",
            "Interés devengado USD",
            "FECI devengado USD",
            "Otros cargos USD",
            "Capital aplicado USD",
            "Capital final USD",
            "Saldo bancario USD",
            "Diferencia USD",
          ],
          ...data.real.periods.map((x) => [
            x.period,
            x.status,
            money(x.opening),
            money(x.interest),
            money(x.feci),
            money(x.other),
            money(x.principal),
            money(x.closing),
            x.bankBalance === null ? "" : money(x.bankBalance),
            x.balanceDifference === null ? "" : money(x.balanceDifference),
          ]),
        ];
      else if (kind === "allocations")
        rows = [
          [
            "Movimiento",
            "Período",
            "Fuente",
            "Capital USD",
            "Interés pagado USD",
            "FECI pagado USD",
            "Otros pagados USD",
            "Compensación USD",
            "Adelanto USD",
          ],
          ...data.real.applications.flatMap((a) =>
            a.allocations.map((x) => [
              a.id,
              a.period,
              x.source,
              money(x.principal),
              money(x.interest),
              money(x.feci),
              money(x.other),
              money(x.compensation),
              money(x.advance),
            ]),
          ),
        ];
      else if (kind === "contributions")
        rows = [
          [
            "ID",
            "Fecha",
            "Período",
            "Fuente",
            "Persona",
            "Recibido USD",
            "Aplicado USD",
            "Estado",
            "Notas",
          ],
          ...data.contributions.map((x) => [
            x.id,
            x.date,
            x.period,
            x.source_id,
            x.contributor,
            x.amount,
            money(
              data.links
                .filter((l) => l.contribution_id === x.id)
                .reduce((s, l) => s + cents(l.amount), 0) +
                data.cashCompensations
                  .filter(
                    (l) => l.status === "active" && l.contribution_id === x.id,
                  )
                  .reduce((s, l) => s + cents(l.amount), 0),
            ),
            x.status,
            x.notes,
          ]),
        ];
      else if (kind === "cash-compensations")
        rows = [
          [
            "ID",
            "Aporte",
            "Fecha",
            "Persona",
            "Importe USD",
            "Compensado USD",
            "Exceso USD",
            "Estado",
            "Revisión",
          ],
          ...data.cashCompensations.map((x) => {
            const a = data.real.cashCompensations?.find((a) => a.id === x.id);
            return [
              x.id,
              x.contribution_id,
              x.date,
              x.contributor,
              x.amount,
              money(a?.applied || 0),
              money(a?.excess || 0),
              x.status,
              x.revision,
            ];
          }),
        ];
      else if (kind === "funds")
        rows = [
          [
            "ID",
            "Fecha",
            "Apartado",
            "Operación",
            "Tipo de movimiento",
            "Importe USD",
            "Cambio USD",
            "Antes USD",
            "Después USD",
            "Motivo",
          ],
          ...data.fundAdjustments.map((r) => [
            r.id,
            r.date,
            r.bucket,
            r.operation,
            fundEffectNames[fundEffect(r)],
            r.amount,
            r.delta,
            r.before_balance,
            r.after_balance,
            r.reason,
          ]),
        ];
      else if (kind === "budget")
        rows = [
          [
            "ID",
            "Fecha",
            "Período",
            "Tipo",
            "Categoría",
            "Importe USD",
            "Concepto",
            "Estado",
            "Origen de fondos",
            "Gasto fijo ID",
          ],
          ...data.cash.map((x) => [
            x.id,
            x.date,
            x.period,
            x.kind,
            x.category,
            x.amount,
            x.concept,
            x.status,
            x.funding,
            x.fixed_expense_id,
          ]),
          ...data.fundAdjustments
            .filter((x) => ["EXPENSE", "INCOME"].includes(fundEffect(x)))
            .map((x) => [
              x.id,
              x.date,
              x.date.slice(0, 7),
              fundEffect(x) === "INCOME"
                ? x.bucket === "SAVINGS"
                  ? "INCOME_TO_SAVINGS"
                  : "INCOME"
                : "WITHDRAWAL",
              x.bucket,
              x.amount,
              x.reason,
              "active",
              x.bucket === "SAVINGS" ? "SAVINGS" : "CASH",
              "",
            ]),
        ];
      else if (kind === "projection")
        rows = [
          [
            "Período",
            "Tipo",
            "Capital inicial USD",
            "Cuota regular USD",
            "Cuota CrediJamar USD",
            "Interés estimado USD",
            "FECI estimado USD",
            "Capital aplicado USD",
            "Capital final USD",
          ],
          ...data.current.schedule.map((x) => [
            x.period,
            "PROYECCIÓN",
            money(x.opening),
            money(x.regular),
            money(x.credi),
            money(x.interest),
            money(x.feci),
            money(x.principal),
            money(x.closing),
          ]),
        ];
      else
        rows = [
          [
            "ID",
            "Fecha",
            "Período",
            "Tipo",
            "Importe USD",
            "Estado",
            "Revisión",
            "Notas",
          ],
          ...data.rawMovements.map((x) => [
            x.id,
            x.date,
            x.period,
            x.type,
            x.amount,
            x.status,
            x.revision,
            x.notes,
          ]),
        ];
      return new Response(
        "\uFEFF" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n"),
        {
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="payadmin-${kind.replace(/[^a-z]/g, "")}.csv"`,
            "Cache-Control": "no-store",
          },
        },
      );
    }
    throw new HttpError(404, "Ruta inexistente.");
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: Request, ctx: Context) {
  try {
    checkOrigin(req);
    const path = (await ctx.params).path;
    const raw = await body(req);
    if (path.join("/") === "initial-registration")
      return response(await registerInitialUser(raw), 201);
    if (path.join("/") === "login") {
      const v = z
        .object({
          email: z.email().max(254),
          password: z.string().min(1).max(256),
        })
        .strict()
        .parse(raw);
      await login(v.email, v.password);
      return response({ ok: true });
    }
    const user = await requireUser();
    if (path.join("/") === "logout") {
      await logout();
      return response({ ok: true });
    }
    if (
      path[0] === "bank" ||
      path[0] === "contribution" ||
      path[0] === "cash"
    ) {
      if (path.length === 1)
        return response(await createRecord(path[0], raw, user.id), 201);
      if (path.length === 2 && z.uuid().safeParse(path[1]).success)
        return response(await correctRecord(path[0], path[1], raw, user.id));
    }
    if (path[0] === "cash-compensation") {
      if (path.length === 1)
        return response(await createCashCompensation(raw, user.id), 201);
      if (path.length === 2 && z.uuid().safeParse(path[1]).success)
        return response(await correctCashCompensation(path[1], raw, user.id));
    }
    if (path.join("/") === "statement")
      return response(await saveStatement(raw, user.id));
    if (path.join("/") === "first-date")
      return response(await confirmFirstDate(raw, user.id));
    if (path.join("/") === "parameters")
      return response(await saveParameters(raw, user.id));
    if (path.join("/") === "fixed-expense")
      return response(await saveFixedExpense(raw, user.id));
    if (path.join("/") === "fund")
      return response(await adjustFund(raw, user.id), 201);
    if (path.join("/") === "responsibilities")
      return response(await saveResponsibilities(raw, user.id));
    if (path.join("/") === "simulate") {
      const v = simulationInput.parse(raw),
        data = await snapshot();
      const next =
        data.real.periods.at(-1)?.period ||
        data.versions[0].firstDue.slice(0, 7);
      if (v.period < next)
        throw new HttpError(400, "La simulación debe ser futura.");
      return response(
        simulate(data.real, data.versions, { ...v, amount: cents(v.amount) }),
      );
    }
    throw new HttpError(404, "Ruta inexistente.");
  } catch (e) {
    return failure(e);
  }
}
