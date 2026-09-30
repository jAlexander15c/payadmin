import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { database } from "../src/lib/db";
import { passwordHash } from "../src/lib/auth";
import { panamaToday, SOURCES, money } from "../src/lib/finance";
import { createRecord, snapshot } from "../src/lib/store";
async function main() {
  if (
    !process.env.DATABASE_URL ||
    !new URL(process.env.DATABASE_URL).pathname.endsWith("_test")
  )
    throw new Error("Esta prueba requiere una BD aislada terminada en _test.");
  const base = process.env.TEST_BASE_URL || "http://localhost:3001",
    user = randomUUID(),
    email = `browser-${user}@payadmin.invalid`,
    password = randomBytes(24).toString("base64url");
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  const today = panamaToday(),
    period = today.slice(0, 7),
    firstDay = period + "-01";
  const original = (
    await database().query(
      "SELECT * FROM parameter_versions ORDER BY effective_period",
    )
  ).rows;
  try {
    if (original.length !== 1)
      throw new Error(
        "La prueba de navegador requiere una base test recién migrada, con una sola versión inicial.",
      );
    await database().query(
      "TRUNCATE bank_movements,contributions,cash_entries,statements,allocations,compensations,period_results,audit_log,responsibility_versions,loan_schedule_versions CASCADE",
    );
    await database().query(
      "UPDATE parameter_versions SET effective_period=$1,first_due=$2 WHERE id=$3",
      [period, period + "-15", original[0].id],
    );
    await database().query(
      "INSERT INTO app_users(id,email,password_hash) VALUES($1,$2,$3)",
      [user, email, await passwordHash(password)],
    );
    const page = await browser.newPage({
        viewport: { width: 1280, height: 900 },
      }),
      errors: string[] = [];
    page.setDefaultTimeout(10000);
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base);
    await page.waitForURL(base + "/login");
    await page.getByLabel("Correo electrónico").fill(email);
    await page.getByLabel("Contraseña").fill(password);
    await page.getByRole("button", { name: "Entrar a PayAdmin" }).click();
    await page.waitForURL(base + "/");
    await page.getByRole("heading", { name: "Hola, Javier." }).waitFor();
    const nav = (label: string) =>
      page
        .locator("aside")
        .getByRole("button", { name: label, exact: true })
        .click();
    const register = () =>
      page
        .getByRole("button", { name: "Registrar movimiento", exact: true })
        .click();
    const save = async () => {
      await page
        .getByRole("button", { name: "Guardar registro", exact: true })
        .click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
    };
    await page.locator(".source-card.cards").click();
    await page
      .getByRole("heading", {
        name: "Tarjetas personales",
        exact: true,
        level: 2,
      })
      .waitFor();
    await nav("Resumen");
    await register();
    await page.getByRole("button", { name: "Aporte", exact: true }).click();
    await page.getByLabel("Fecha real").fill(firstDay);
    await page.getByLabel("Período", { exact: true }).fill(period);
    await page.getByLabel("Persona o negocio que aporta").fill("Chunky Bites");
    await page.getByLabel("Importe (USD)").fill("171.24");
    await save();
    let data = await (await page.request.get(base + "/api/snapshot")).json();
    assert.equal(data.real.paid, 0);
    assert.equal(data.totals.received, 17124);
    await register();
    await page.getByLabel("Fecha real").fill(firstDay);
    await page.getByLabel("Importe (USD)").fill("317.60");
    await page.getByRole("button", { name: "Añadir", exact: true }).click();
    await page
      .getByLabel("Aporte recibido 1")
      .selectOption(data.contributions[0].id);
    await page.getByLabel("Importe vinculado USD").fill("171.24");
    await save();
    await register();
    await page.getByLabel("Tipo de movimiento").selectOption("CREDI");
    await page.getByLabel("Fecha real").fill(today);
    await page.getByLabel("Importe (USD)").fill("62.56");
    await save();
    data = await (await page.request.get(base + "/api/snapshot")).json();
    assert.equal(data.real.paid, 38016);
    assert.equal(data.real.advance, 0);
    assert.equal(data.real.applications[1].compensation, 1180);
    await nav("Movimientos");
    const row = page
      .getByRole("row")
      .filter({ has: page.getByText("Pago regular BG", { exact: true }) })
      .filter({
        has: page.getByRole("button", { name: "Corregir", exact: true }),
      });
    await row.getByRole("button", { name: "Corregir", exact: true }).click();
    await page.getByLabel("Importe (USD)").fill("158.80");
    await page.getByLabel("Importe vinculado USD").fill("85.62");
    await page
      .getByLabel("Motivo para la auditoría")
      .fill("Descuento quincenal real corregido");
    await page.getByRole("button", { name: "Guardar corrección" }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    data = await (await page.request.get(base + "/api/snapshot")).json();
    assert.equal(data.real.paid, 22136);
    assert.ok(data.audit.some((x: any) => x.action === "correct"));
    await nav("Proyecciones");
    await page.getByRole("button", { name: "Calcular impacto" }).click();
    await page.getByText("Interés + FECI evitados", { exact: true }).waitFor();
    await nav("Controles de cuadre");
    await page.getByRole("button", { name: "Ingresar extracto" }).click();
    await page.getByLabel("Interés devengado", { exact: true }).fill("0");
    await page.getByLabel("FECI devengado", { exact: true }).fill("0");
    await page.getByLabel("Saldo capital reportado").fill("18000");
    await page
      .getByLabel("Motivo para la auditoría")
      .fill("Extracto de prueba con cero confirmado");
    await save();
    data = await (await page.request.get(base + "/api/snapshot")).json();
    assert.equal(data.real.periods[0].interest, 0);
    assert.equal(data.real.periods[0].feci, 0);
    assert.notEqual(data.real.periods[0].balanceDifference, 0);
    await nav("Mi presupuesto");
    await page.getByRole("button", { name: "Registrar caja" }).click();
    await page.getByLabel("Fecha real").fill(firstDay);
    await page.locator("select[name=cashKind]").selectOption("PAYROLL");
    await page.getByLabel("Importe (USD)").fill("496.66");
    await page
      .getByLabel("Concepto", { exact: true })
      .fill("Planilla neta recibida");
    await save();
    await page.getByRole("button", { name: "Mes completo" }).click();
    await page.getByText("$605.34", { exact: true }).waitFor();
    assert.ok(
      (await page.locator(".metrics-grid").innerText()).includes("$605.34"),
    );
    const exported = await page.request.get(
      base + "/api/export?kind=allocations",
    );
    assert.equal(exported.status(), 200);
    assert.ok((await exported.text()).includes("Compensación USD"));
    assert.equal(
      (
        await page.request.post(base + "/api/cash", {
          headers: { Origin: "https://other.invalid" },
          data: {},
        })
      ).status(),
      403,
    );
    await nav("Historial y auditoría");
    assert.ok(
      (await page.locator(".content").innerText()).includes("$1,512.96"),
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Abrir navegación" }).click();
    await page
      .locator("aside")
      .getByRole("button", { name: "Resumen", exact: true })
      .click();
    await page.waitForTimeout(250);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      ),
      false,
    );
    await register();
    await page.getByRole("dialog").waitFor();
    assert.equal(
      await page.getByLabel("Importe (USD)").getAttribute("inputmode"),
      "decimal",
    );
    await page.getByRole("button", { name: "Cerrar formulario" }).click();
    // A separate isolated fixture covers the post-cancellation reimbursement form.
    await database().query(
      "TRUNCATE bank_movements,contributions,cash_entries,statements,cash_compensations,allocations,compensations,period_results,audit_log CASCADE",
    );
    const record = (type: string, amount: string) =>
      createRecord(
        "bank",
        {
          requestKey: randomUUID(),
          date: firstDay,
          period,
          type,
          amount,
          notes: "",
          links: [],
        },
        user,
        today,
      );
    await record("REGULAR", "317.60");
    const targets = {
      chunky: "EXTRA_CHUNKY",
      credi: "EXTRA_CREDI",
      cards: "EXTRA_CARDS",
      costs: "EXTRA_COSTS",
    };
    for (const s of SOURCES)
      await record(
        targets[s],
        money((await snapshot(today)).real.bags[s].capital),
      );
    const receipt = (
      await createRecord(
        "contribution",
        {
          requestKey: randomUUID(),
          date: today,
          period,
          source: "credi",
          contributor: "CrediJamar",
          amount: "11.80",
          notes: "",
        },
        user,
        today,
      )
    ).id;
    const bankPaid = (await snapshot(today)).real.paid;
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.reload();
    await nav("Movimientos");
    await page
      .getByRole("button", { name: "Aportes recibidos", exact: true })
      .click();
    await page.getByLabel("Aporte CrediJamar recibido").selectOption(receipt);
    await page
      .getByLabel("Motivo del reembolso")
      .fill("Reembolso real al cancelar BG");
    await page
      .getByRole("button", { name: "Aplicar reembolso recibido" })
      .click();
    await page.getByRole("button", { name: "Revisar reembolso" }).waitFor();
    data = await (await page.request.get(base + "/api/snapshot")).json();
    assert.equal(data.real.advance, 0);
    assert.equal(data.real.paid, bankPaid);
    assert.equal(data.totals.received, 1180);
    await page.getByRole("button", { name: "Revisar reembolso" }).click();
    await page.getByLabel("Acción sobre el reembolso").selectOption("void");
    await page
      .getByLabel("Motivo del reembolso")
      .fill("Anular aplicación conservando aporte");
    await page
      .getByRole("button", { name: "Guardar cambio del reembolso" })
      .click();
    await page
      .getByRole("button", { name: "Aplicar reembolso recibido" })
      .waitFor();
    data = await (await page.request.get(base + "/api/snapshot")).json();
    assert.equal(data.real.advance, 1180);
    assert.equal(data.real.paid, bankPaid);
    assert.equal(data.totals.received, 1180);
    if (errors.length) throw new Error(errors.join("\n"));
    console.log(
      "Navegador: login, aportes, pago vinculado, compensación, corrección, simulador, extracto cero, caja, CSV, CSRF, formulario móvil y reembolso al cancelar: OK.",
    );
  } finally {
    await browser.close();
    await database().query(
      "TRUNCATE bank_movements,contributions,cash_entries,statements,allocations,compensations,period_results,audit_log,responsibility_versions,loan_schedule_versions CASCADE",
    );
    for (const p of original)
      await database().query(
        "UPDATE parameter_versions SET effective_period=$2,first_due=$3 WHERE id=$1",
        [p.id, p.effective_period, p.first_due],
      );
    await database().query("DELETE FROM app_users WHERE id=$1", [user]);
    await database().end();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
