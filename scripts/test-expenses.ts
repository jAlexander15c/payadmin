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
      "SELECT (SELECT count(*) FROM cash_entries)+(SELECT count(*) FROM fixed_expenses)+(SELECT count(*) FROM fund_adjustments) AS n",
    );
    if (Number(clean.rows[0].n))
      throw new Error(
        "La prueba requiere una base _test sin movimientos ni gastos fijos.",
      );
    for (const path of [
      "/api/expense-entry",
      "/api/fixed-expense",
      "/api/fund",
    ]) {
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
    const get = async (path: string) => {
      const r = await page.request.get(base + path);
      assert.equal(r.status(), 200);
      return r.json();
    };
    const snapshot = () => get("/api/snapshot"),
      expenses = () => get(`/api/expenses?period=${period}&half=all`),
      budget = () => get(`/api/budget?period=${period}&half=all`);
    const save = async (name = "Guardar movimiento") => {
      await page.getByRole("button", { name, exact: true }).click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
    };
    const beforeBudget = await budget(),
      beforeSnapshot = await snapshot();
    await nav("Mis gastos");
    await page.getByRole("heading", { name: "Mis gastos." }).waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Ver presupuesto", exact: true })
        .count(),
      0,
    );
    assert.equal(
      await page
        .getByRole("heading", { name: "Disponible por categoría", exact: true })
        .count(),
      0,
    );
    for (const [bucket, amount] of [
      ["NEEDS", "100.00"],
      ["WANTS", "80.00"],
      ["SAVINGS", "40.00"],
    ]) {
      await page
        .locator(`[data-fund="${bucket}"]`)
        .getByRole("button", { name: "Editar total", exact: true })
        .click();
      await page.getByLabel("Nuevo total (USD)").fill(amount);
      await save("Guardar cambio");
    }
    let b = await expenses();
    assert.equal(b.income, 0);
    assert.equal(b.spent, 0);
    const entry = async (
      type: "income" | "expense",
      bucket: string,
      amount: string,
      concept: string,
    ) => {
      await page
        .getByRole("button", {
          name: type === "income" ? "Registrar ingreso" : "Registrar gasto",
          exact: true,
        })
        .click();
      await page.getByLabel(/^Apartado/).selectOption(bucket);
      await page.getByLabel("Concepto", { exact: true }).fill(concept);
      await page.getByLabel("Importe (USD)").fill(amount);
      await save();
    };
    await entry("income", "NEEDS", "50.00", "Ingreso para fijos de prueba");
    await entry("income", "WANTS", "20.00", "Ingreso personal de prueba");
    await entry("income", "SAVINGS", "10.00", "Ingreso a ahorro de prueba");
    assert.deepEqual(
      (await snapshot()).funds.map((r: any) => r.balance),
      [15000, 10000, 5000],
    );
    assert.equal((await expenses()).income, 8000);
    await page
      .getByRole("button", { name: "Definir gasto fijo", exact: true })
      .click();
    await page.getByLabel("Nombre del gasto").fill("Internet · prueba visual");
    await page.getByLabel("Vigente desde el mes").fill(period);
    await page.getByLabel("Día de vencimiento").fill("1");
    await page.getByLabel("Importe (USD)").fill("60.00");
    await save("Guardar gasto fijo");
    fixedId = (await snapshot()).fixedExpenses[0].fixed_id;
    const fixed = page.locator(".expense-fixed").filter({
      has: page.getByRole("heading", {
        name: "Internet · prueba visual",
        exact: true,
      }),
    });
    await fixed
      .getByRole("button", { name: "Registrar pago", exact: true })
      .click();
    await page.getByLabel("Importe (USD)").fill("20.00");
    await save();
    assert.equal((await expenses()).fixed[0].pending, 4000);
    const row = page
      .locator("tbody tr")
      .filter({ hasText: "Internet · prueba visual" });
    await row.getByRole("button", { name: "Corregir / anular" }).click();
    await page.getByLabel("Importe (USD)").fill("25.00");
    await page
      .getByLabel("Motivo para la auditoría")
      .fill("Corrección de importe de prueba");
    await save("Guardar corrección");
    assert.equal((await expenses()).fixed[0].pending, 3500);
    assert.equal((await snapshot()).funds[0].balance, 12500);
    await row.getByRole("button", { name: "Corregir / anular" }).click();
    await page.getByRole("button", { name: "Anular", exact: true }).click();
    await page
      .getByLabel("Motivo para la auditoría")
      .fill("Pago de prueba anulado");
    await save("Anular con auditoría");
    assert.equal((await expenses()).fixed[0].pending, 6000);
    assert.equal((await snapshot()).funds[0].balance, 15000);
    await fixed
      .getByRole("button", { name: "Registrar pago", exact: true })
      .click();
    await save();
    assert.equal((await expenses()).fixed[0].pending, 0);
    await entry("expense", "WANTS", "15.00", "Almuerzo · prueba visual");
    await entry(
      "expense",
      "SAVINGS",
      "5.00",
      "Salida de ahorro · prueba visual",
    );
    b = await expenses();
    assert.equal(b.spent, 8000);
    assert.equal(b.net, 0);
    assert.deepEqual(
      b.categories.map((c: any) => c.spent),
      [6000, 1500, 500],
    );
    await page
      .getByRole("heading", { name: "Consumo por categoría", exact: true })
      .waitFor();
    await page
      .getByRole("heading", { name: "Entradas y salidas por día", exact: true })
      .waitFor();
    await page.getByRole("img", { name: /Total consumido: \$80.00/ }).waitFor();
    assert.deepEqual(await budget(), beforeBudget);
    assert.equal((await snapshot()).real.paid, beforeSnapshot.real.paid);
    const personal = page.locator('[data-fund="WANTS"]');
    await personal
      .getByRole("button", { name: "Agregar", exact: true })
      .click();
    await page.getByLabel("Importe (USD)").fill("40.00");
    await save("Guardar cambio");
    await personal.getByRole("button", { name: "Sacar", exact: true }).click();
    await page.getByLabel("¿Qué quieres registrar?").selectOption("ADJUSTMENT");
    await page.getByLabel("Importe (USD)").fill("10.00");
    await save("Guardar cambio");
    b = await expenses();
    assert.equal(b.income, 12000);
    assert.equal(b.spent, 8000);
    assert.equal(b.net, 4000);
    assert.equal((await snapshot()).funds[1].balance, 11500);
    await personal.getByRole("button", { name: "Sacar", exact: true }).click();
    await page.getByLabel("Importe (USD)").fill("5.00");
    await save("Guardar cambio");
    assert.equal((await expenses()).spent, 8500);
    assert.deepEqual(await budget(), beforeBudget);
    const current = (await snapshot()).funds[1].balance;
    const add = await page.request.post(base + "/api/fund", {
      headers: { Origin: base },
      data: {
        requestKey: randomUUID(),
        bucket: "WANTS",
        operation: "ADD",
        effect: "ALLOCATION",
        amount: "1.00",
        expectedBalance: current,
      },
    });
    assert.equal(add.status(), 201);
    const conflict = await page.request.post(base + "/api/fund", {
      headers: { Origin: base },
      data: {
        requestKey: randomUUID(),
        bucket: "WANTS",
        operation: "SET",
        amount: "0",
        expectedBalance: current,
      },
    });
    assert.equal(conflict.status(), 409);
    const oldExpense = (await snapshot()).expenseCash.find(
      (r: any) => r.status === "active",
    );
    assert.equal(
      (
        await page.request.post(base + `/api/cash/${oldExpense.id}`, {
          headers: { Origin: base },
          data: {
            revision: oldExpense.revision,
            action: "void",
            reason: "Cruce de apartados de prueba",
          },
        })
      ).status(),
      404,
    );
    const payroll = await page.request.post(base + "/api/cash", {
      headers: { Origin: base },
      data: {
        requestKey: randomUUID(),
        date: today,
        period,
        kind: "PAYROLL",
        category: "OTHER",
        amount: "100.00",
        concept: "Planilla aislada de prueba",
      },
    });
    assert.equal(payroll.status(), 201);
    const payrollId = (await payroll.json()).id;
    assert.equal((await budget()).income, beforeBudget.income + 10000);
    assert.equal((await expenses()).income, 12000);
    assert.equal(
      (
        await page.request.post(base + `/api/expense-entry/${payrollId}`, {
          headers: { Origin: base },
          data: {
            revision: 1,
            action: "void",
            reason: "Cruce de apartados de prueba",
          },
        })
      ).status(),
      404,
    );
    const expenseCsv = await page.request.get(
        base + "/api/export?kind=expenses",
      ),
      budgetCsv = await page.request.get(base + "/api/export?kind=budget");
    assert.equal(expenseCsv.status(), 200);
    assert.equal(budgetCsv.status(), 200);
    assert.match(await expenseCsv.text(), /Internet · prueba visual/);
    assert.doesNotMatch(await expenseCsv.text(), /Planilla aislada/);
    assert.match(await budgetCsv.text(), /Planilla aislada/);
    assert.doesNotMatch(await budgetCsv.text(), /Internet · prueba visual/);
    await page.reload();
    await nav("Mis gastos");
    assert.equal((await expenses()).spent, 8500);
    assert.deepEqual(
      (await snapshot()).funds.map((r: any) => r.balance),
      [9000, 11100, 4500],
    );
    await page
      .getByRole("button", { name: "Personal y variables", exact: true })
      .click();
    await page
      .getByRole("heading", {
        name: "Gastos personales y variables",
        exact: true,
      })
      .waitFor();
    assert.equal(
      await page
        .locator("table tbody")
        .getByText("Almuerzo · prueba visual", { exact: true })
        .count(),
      1,
    );
    await page.getByRole("button", { name: "Ahorro", exact: true }).click();
    assert.equal(
      await page
        .locator("table tbody")
        .getByText("Salida de ahorro · prueba visual", { exact: true })
        .count(),
      1,
    );
    await page
      .getByRole("button", { name: "Todos los movimientos", exact: true })
      .click();
    const overflow = async () =>
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
    await mkdir(".local/prototype", { recursive: true });
    await overflow();
    await page.screenshot({
      path: ".local/prototype/gastos-dark.png",
      fullPage: true,
    });
    await page.getByRole("button", { name: "Activar modo claro" }).click();
    await page.waitForTimeout(250);
    await overflow();
    await page.screenshot({
      path: ".local/prototype/gastos-light.png",
      fullPage: true,
    });
    await page.getByRole("button", { name: "Activar modo oscuro" }).click();
    await page.waitForTimeout(250);
    await page.setViewportSize({ width: 390, height: 844 });
    await overflow();
    await page.screenshot({
      path: ".local/prototype/gastos-mobile.png",
      fullPage: true,
    });
    await page
      .locator(".fund-totals")
      .screenshot({ path: ".local/prototype/totales-mobile.png" });
    await entry("income", "WANTS", "1.00", "Ingreso móvil de prueba");
    assert.equal((await expenses()).income, 12100);
    assert.equal((await snapshot()).funds[1].balance, 11200);
    await page
      .getByRole("button", { name: "Registrar gasto", exact: true })
      .click();
    await overflow();
    await page.screenshot({
      path: ".local/prototype/gasto-form-mobile.png",
      fullPage: true,
    });
    await page.getByRole("button", { name: "Cerrar gasto" }).click();
    await page.getByRole("button", { name: "Abrir navegación" }).click();
    await nav("Mi presupuesto");
    await page.getByLabel("Período", { exact: true }).fill(period);
    await page
      .getByRole("button", { name: "Mes completo", exact: true })
      .click();
    await page
      .getByRole("heading", {
        name: "Referencia salarial 50 / 30 / 20",
        exact: true,
      })
      .waitFor();
    assert.equal(
      await page
        .getByRole("heading", { name: "Consumo por categoría", exact: true })
        .count(),
      0,
    );
    await overflow();
    assert.deepEqual(errors, []);
    console.log(
      "Mis gastos independiente: ingresos/salidas, categorías, gráficos, saldos, fijos parciales, corrección/anulación, origen, idempotencia, CSV separado, persistencia, ambos temas y móvil: OK.",
    );
  } finally {
    await browser.close();
    await database().query("DELETE FROM audit_log WHERE user_id=$1", [user]);
    await database().query("DELETE FROM fund_adjustments WHERE created_by=$1", [
      user,
    ]);
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
    await database().query("DELETE FROM sessions WHERE user_id=$1", [user]);
    await database().query("DELETE FROM app_users WHERE id=$1", [user]);
    await database().end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
