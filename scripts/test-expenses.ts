import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { database } from "../src/lib/db";
import { passwordHash } from "../src/lib/auth";
import { panamaToday } from "../src/lib/finance";
async function main() {
  if (
    !process.env.DATABASE_URL ||
    !new URL(process.env.DATABASE_URL).pathname.endsWith("_test")
  )
    throw new Error("Usa exclusivamente una BD aislada _test.");
  const base = process.env.TEST_BASE_URL || "http://localhost:3001",
    user = randomUUID(),
    email = `expenses-browser-${user}@payadmin.invalid`,
    password = randomBytes(24).toString("base64url"),
    today = panamaToday(),
    period = today.slice(0, 7);
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  let fixedId = "";
  try {
    const clean = await database().query(
      "SELECT (SELECT count(*) FROM cash_entries)+(SELECT count(*) FROM fixed_expenses) AS n",
    );
    if (Number(clean.rows[0].n) !== 0)
      throw new Error(
        "La prueba requiere una base _test sin movimientos ni gastos fijos.",
      );
    for (const path of ["/api/cash", "/api/fixed-expense"]) {
      assert.equal(
        (
          await fetch(base + path, {
            method: "POST",
            headers: { Origin: base, "Content-Type": "application/json" },
            body: "{}",
          })
        ).status,
        401,
      );
      assert.equal(
        (
          await fetch(base + path, {
            method: "POST",
            headers: {
              Origin: "https://other.invalid",
              "Content-Type": "application/json",
            },
            body: "{}",
          })
        ).status,
        403,
      );
    }
    await database().query(
      "INSERT INTO app_users(id,email,password_hash) VALUES($1,$2,$3)",
      [user, email, await passwordHash(password)],
    );
    const context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
      }),
      page = await context.newPage(),
      errors: string[] = [];
    page.setDefaultTimeout(10000);
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript("globalThis.__name = (target) => target;");
    await page.goto(base + "/login");
    await page.getByLabel("Correo electrónico").fill(email);
    await page.getByLabel("Contraseña").fill(password);
    await page.getByRole("button", { name: "Entrar a PayAdmin" }).click();
    await page.waitForURL(base + "/");
    const nav = (name: string) =>
      page.locator("aside").getByRole("button", { name, exact: true }).click();
    const snapshot = async () => {
      const r = await page.request.get(base + "/api/snapshot");
      assert.equal(r.status(), 200);
      return r.json();
    };
    const budget = async () => {
      const r = await page.request.get(
        base + `/api/budget?period=${period}&half=all`,
      );
      assert.equal(r.status(), 200);
      return r.json();
    };
    const save = async (name = "Guardar movimiento") => {
      await page.getByRole("button", { name, exact: true }).click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
    };
    await nav("Mis gastos");
    await page.getByRole("heading", { name: "Mis gastos." }).waitFor();
    await page.getByRole("button", { name: "Definir gasto fijo" }).click();
    await page.getByLabel("Nombre del gasto").fill("Internet · prueba visual");
    await page.getByLabel("Vigente desde el mes").fill(period);
    await page.getByLabel("Día de vencimiento").fill("1");
    await page.getByLabel("Importe (USD)").fill("100.00");
    await save("Guardar gasto fijo");
    let d = await snapshot();
    fixedId = d.fixedExpenses.find((r: any) => r.created_by === user).fixed_id;
    assert.equal(d.cash.length, 0);
    assert.equal(d.real.paid, 0);
    assert.equal((await budget()).fixedPending, 10000);
    const firstRemaining = (await budget()).categories[0].remaining;
    await page
      .locator(".expense-fixed")
      .getByRole("button", { name: "Registrar pago" })
      .click();
    await page.getByLabel("Importe (USD)").fill("30.00");
    await save();
    assert.equal((await budget()).fixedPending, 7000);
    assert.equal((await budget()).categories[0].remaining, firstRemaining);
    await page
      .locator(".expense-fixed")
      .getByText("Pago parcial", { exact: true })
      .waitFor();
    await page
      .locator(".expense-fixed")
      .getByRole("button", { name: "Registrar pago" })
      .click();
    await save();
    await page.locator(".expense-fixed .status-badge.success").waitFor();
    assert.equal((await budget()).fixedPending, 0);
    d = await snapshot();
    const first = d.cash.find((r: any) => r.amount === "30.00");
    await page
      .getByRole("row")
      .filter({ hasText: "$30.00" })
      .getByRole("button", { name: "Corregir / anular" })
      .click();
    await page.getByLabel("Importe (USD)").fill("20.00");
    await page
      .getByLabel("Motivo para la auditoría")
      .fill("Importe revisado en la prueba visual");
    await save("Guardar corrección");
    assert.equal((await budget()).fixedPending, 1000);
    await page
      .getByRole("row")
      .filter({ hasText: "$20.00" })
      .getByRole("button", { name: "Corregir / anular" })
      .click();
    await page.getByRole("button", { name: "Anular", exact: true }).click();
    await page
      .getByLabel("Motivo para la auditoría")
      .fill("Pago de prueba anulado por corrección");
    await save("Anular con auditoría");
    assert.equal((await budget()).fixedPending, 3000);
    d = await snapshot();
    assert.equal(d.cash.find((r: any) => r.id === first.id).status, "void");
    await page
      .getByRole("button", { name: "Registrar gasto", exact: true })
      .click();
    await page.getByLabel("Concepto").fill("Personal · prueba visual");
    await page.getByLabel("Importe (USD)").fill("25.00");
    await save();
    assert.equal((await budget()).categories[1].used, 2500);
    await page
      .getByRole("button", { name: "Registrar ahorro o saldo previo" })
      .click();
    await page.getByLabel("Tipo de ahorro").selectOption("SAVINGS_OPENING");
    await page.getByLabel("Importe (USD)").fill("100.00");
    await save();
    await page
      .getByRole("button", { name: "Registrar ahorro o saldo previo" })
      .click();
    await page.getByLabel("Importe (USD)").fill("20.00");
    await save();
    await page
      .getByRole("button", { name: "Registrar gasto", exact: true })
      .click();
    await page.getByLabel("Origen del dinero").selectOption("SAVINGS");
    await page.getByLabel("Concepto").fill("Desde ahorro · prueba visual");
    await page.getByLabel("Importe (USD)").fill("30.00");
    await save();
    let b = await budget();
    assert.equal(b.savingsBalance, 9000);
    assert.equal(b.actualCash, -11500);
    assert.equal(b.categories[1].used, 2500);
    assert.equal(b.categories[2].used, 2000);
    await page
      .getByRole("button", { name: "Registrar gasto", exact: true })
      .click();
    await page.getByLabel("Concepto").fill("Sobregiro de prueba");
    await page.getByLabel("Importe (USD)").fill("1000.00");
    await page
      .getByRole("status")
      .filter({ hasText: "se permite con alerta" })
      .waitFor();
    await save();
    assert.ok((await budget()).categories[1].remaining < 0);
    await page
      .getByRole("button", { name: "Personal y variables", exact: true })
      .click();
    await page
      .getByRole("row")
      .filter({ hasText: "Sobregiro de prueba" })
      .getByRole("button", { name: "Corregir / anular" })
      .click();
    await page.getByRole("button", { name: "Anular", exact: true }).click();
    await page
      .getByLabel("Motivo para la auditoría")
      .fill("Retirar gasto de sobregiro de prueba");
    await save("Anular con auditoría");
    const income = await page.request.post(base + "/api/cash", {
      headers: { Origin: base },
      data: {
        requestKey: randomUUID(),
        date: today,
        period,
        kind: "PAYROLL",
        category: "OTHER",
        amount: "496.66",
        concept: "Planilla neta · prueba visual",
      },
    });
    assert.equal(income.status(), 201);
    await nav("Mi presupuesto");
    await page.getByLabel("Período", { exact: true }).fill(period);
    await page
      .getByRole("button", { name: "Mes completo", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Disponible por categoría" })
      .waitFor();
    await page.getByText("$381.66", { exact: true }).waitFor();
    await page.reload();
    await nav("Mis gastos");
    b = await budget();
    assert.equal(b.actualCash, 38166);
    assert.equal(b.savingsBalance, 9000);
    assert.equal((await snapshot()).real.paid, 0);
    const csv = await page.request.get(base + "/api/export?kind=budget");
    assert.equal(csv.status(), 200);
    assert.match(await csv.text(), /Origen de fondos/);
    assert.match(await csv.text(), /SAVINGS/);
    await mkdir(".local/prototype", { recursive: true });
    const overflow = async () =>
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
    await overflow();
    await page.screenshot({
      path: ".local/prototype/gastos-dark.png",
      fullPage: true,
    });
    await page.getByRole("button", { name: "Activar modo claro" }).click();
    await overflow();
    await page.screenshot({
      path: ".local/prototype/gastos-light.png",
      fullPage: true,
    });
    await page.getByRole("button", { name: "Activar modo oscuro" }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(250);
    await overflow();
    await page.screenshot({
      path: ".local/prototype/gastos-mobile.png",
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Registrar gasto", exact: true })
      .click();
    await overflow();
    await page.getByLabel("Concepto").fill("Formulario móvil · prueba visual");
    await page.getByLabel("Importe (USD)").fill("2.00");
    await page.screenshot({
      path: ".local/prototype/gasto-form-mobile.png",
      fullPage: true,
    });
    await page.getByRole("button", { name: "Cerrar gasto" }).click();
    await page.getByRole("button", { name: "Abrir navegación" }).click();
    await nav("Mi presupuesto");
    await page.getByRole("heading", { name: "Mi presupuesto." }).waitFor();
    await overflow();
    assert.deepEqual(errors, []);
    console.log(
      "Gastos: configuración, pagos parciales, corrección/anulación, personal, ahorro acumulado, sobregiro visible, caja compartida, persistencia, temas y móvil: OK.",
    );
  } finally {
    await browser.close();
    await database().query("DELETE FROM audit_log WHERE user_id=$1", [user]);
    await database().query("DELETE FROM cash_entries WHERE created_by=$1", [
      user,
    ]);
    await database().query(
      "DELETE FROM fixed_expense_versions WHERE created_by=$1",
      [user],
    );
    if (fixedId)
      await database().query("DELETE FROM fixed_expenses WHERE id=$1", [
        fixedId,
      ]);
    await database().query("DELETE FROM app_users WHERE id=$1", [user]);
    await database().end();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
