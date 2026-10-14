import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { database } from "../src/lib/db";
import { passwordHash } from "../src/lib/auth";
import { panamaToday } from "../src/lib/finance";
import { expensesFor } from "../src/lib/expenses";
async function main() {
  if (
    !process.env.DATABASE_URL ||
    !new URL(process.env.DATABASE_URL).pathname.endsWith("_test")
  )
    throw new Error("Usa exclusivamente una BD aislada _test.");
  const base = process.env.TEST_BASE_URL || "http://localhost:3001",
    user = randomUUID(),
    email = `payroll-browser-${user}@payadmin.invalid`,
    password = randomBytes(24).toString("base64url");
  const db = database();
  assert.equal(
    Number(
      (
        await db.query(
          "SELECT (SELECT count(*) FROM cash_entries)+(SELECT count(*) FROM payroll_cycles)+(SELECT count(*) FROM bank_movements) AS n",
        )
      ).rows[0].n,
    ),
    0,
    "Se requiere una base _test vacía de movimientos.",
  );
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  try {
    await db.query(
      "INSERT INTO app_users(id,email,password_hash) VALUES($1,$2,$3)",
      [user, email, await passwordHash(password)],
    );
    const context = await browser.newContext({
        viewport: { width: 1440, height: 1050 },
      }),
      page = await context.newPage(),
      errors: string[] = [];
    page.setDefaultTimeout(15000);
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript("globalThis.__name = (target) => target;");
    for (const path of [
      "/api/payroll",
      "/api/payroll-receipt",
      `/api/payroll/${randomUUID()}/void`,
      `/api/payroll-receipt/${randomUUID()}/void`,
    ]) {
      assert.equal(
        (
          await page.request.post(base + path, {
            headers: { Origin: base },
            data: {},
          })
        ).status(),
        401,
      );
      assert.equal(
        (
          await page.request.post(base + path, {
            headers: { Origin: "https://other.invalid" },
            data: {},
          })
        ).status(),
        403,
      );
    }
    await page.goto(base + "/login");
    await page.getByLabel("Correo electrónico").fill(email);
    await page.getByLabel("Contraseña").fill(password);
    await page.getByRole("button", { name: "Entrar a PayAdmin" }).click();
    await page.waitForURL(base + "/");
    await page
      .locator("aside")
      .getByRole("button", { name: "Mis gastos", exact: true })
      .click();
    const get = async () => {
      const r = await page.request.get(base + "/api/snapshot");
      assert.equal(r.status(), 200);
      return r.json();
    };
    const save = async (name: string) => {
      await page.getByRole("button", { name, exact: true }).click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
    };
    const before = await get();
    await page
      .getByRole("button", { name: "Confirmar salario", exact: true })
      .click();
    assert.equal(
      await page
        .getByLabel("Salario neto recibido (USD)", { exact: true })
        .inputValue(),
      "496.66",
    );
    assert.equal(
      await page
        .getByLabel("Deducción del préstamo en esta quincena (USD)")
        .inputValue(),
      "158.80",
    );
    assert.equal(
      await page
        .getByLabel("Próximo vencimiento mensual del préstamo")
        .inputValue(),
      "2026-11-16",
    );
    await page
      .getByLabel("Salario neto recibido (USD)", { exact: true })
      .fill("500.00");
    assert.equal(
      await page.getByLabel("Fijo (USD)", { exact: true }).inputValue(),
      "250.00",
    );
    await page.getByLabel("Fijo (USD)", { exact: true }).fill("240.00");
    assert.equal(
      await page
        .getByRole("button", { name: "Confirmar y repartir", exact: true })
        .isDisabled(),
      true,
    );
    await page.getByLabel("Ahorro (USD)", { exact: true }).fill("110.00");
    await mkdir(".local/prototype", { recursive: true });
    await page.screenshot({
      path: ".local/prototype/quincena-form.png",
      fullPage: true,
    });
    await save("Confirmar y repartir");
    let d = await get();
    assert.equal(d.payrollCycles.length, 1);
    assert.equal(d.real.paid, 15880);
    assert.equal(d.contributions.length, 0);
    assert.deepEqual(
      d.funds.map((r: any) => r.balance),
      [24000, 15000, 11000],
    );
    assert.equal(
      d.rawMovements.some((r: any) => r.type === "CREDI"),
      false,
    );
    assert.deepEqual(
      expensesFor(d, panamaToday().slice(0, 7), "all").categories.map(
        (r) => r.salaryReference,
      ),
      expensesFor(before, panamaToday().slice(0, 7), "all").categories.map(
        (r) => r.salaryReference,
      ),
    );
    await page
      .getByTestId("payroll-cycle")
      .getByText("$85.62 por cobrar", { exact: false })
      .waitFor();
    await page.getByRole("button", { name: "Recibí pago de Chunky" }).click();
    assert.equal(
      await page
        .getByRole("button", { name: "Guardar cobro y reparto", exact: true })
        .isDisabled(),
      true,
    );
    await page
      .getByLabel("¿Dónde quieres poner este dinero?")
      .selectOption("SAVINGS");
    await save("Guardar cobro y reparto");
    d = await get();
    assert.equal(d.real.paid, 15880);
    assert.equal(d.contributions.length, 1);
    assert.equal(d.contributions[0].amount, "85.62");
    assert.deepEqual(
      d.funds.map((r: any) => r.balance),
      [24000, 15000, 19562],
    );
    assert.equal(d.parameters.salary, before.parameters.salary);
    const expenseResponse = await page.request.get(
      `${base}/api/expenses?period=${panamaToday().slice(0, 7)}&half=all`,
    );
    assert.equal((await expenseResponse.json()).income, 58562);
    await page.reload();
    await page
      .locator("aside")
      .getByRole("button", { name: "Mis gastos", exact: true })
      .click();
    await page
      .getByTestId("payroll-cycle")
      .getByText("Chunky · Cobrado", { exact: true })
      .waitFor();
    await page.evaluate(() =>
      document.documentElement.setAttribute("data-theme", "dark"),
    );
    await page.screenshot({
      path: ".local/prototype/quincena-dark.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      true,
      "Sin desborde horizontal móvil",
    );
    await page.screenshot({
      path: ".local/prototype/quincena-mobile.png",
      fullPage: true,
    });
    await page.getByText("Ver detalle y corregir", { exact: true }).click();
    await page
      .getByRole("button", { name: "Anular cobro", exact: true })
      .click();
    await page
      .getByLabel("Motivo", { exact: true })
      .fill("Corregir cobro de prueba");
    await save("Confirmar anulación");
    d = await get();
    assert.equal(d.real.paid, 15880);
    assert.deepEqual(
      d.funds.map((r: any) => r.balance),
      [24000, 15000, 11000],
    );
    await page
      .getByRole("button", { name: "Anular quincena", exact: true })
      .click();
    await page
      .getByLabel("Motivo", { exact: true })
      .fill("Corregir salario de prueba");
    await save("Confirmar anulación");
    d = await get();
    assert.equal(d.real.paid, 0);
    assert.deepEqual(
      d.funds.map((r: any) => r.balance),
      [0, 0, 0],
    );
    assert.equal(d.payrollCycles[0].status, "void");
    assert.deepEqual(errors, []);
    console.log(
      "OK: salario real, reparto, deducción, cobro completo, persistencia, anulación, autenticación/origen y móvil.",
    );
  } finally {
    await browser.close();
    await db.query("DELETE FROM audit_log WHERE user_id=$1", [user]);
    await db.query(
      "DELETE FROM cash_entries WHERE created_by=$1 AND ledger='EXPENSES'",
      [user],
    );
    await db.query("DELETE FROM payroll_receipts WHERE created_by=$1", [user]);
    await db.query("DELETE FROM payroll_cycles WHERE created_by=$1", [user]);
    await db.query("DELETE FROM cash_entries WHERE created_by=$1", [user]);
    await db.query("DELETE FROM contributions WHERE created_by=$1", [user]);
    await db.query(
      "DELETE FROM compensations WHERE movement_id IN (SELECT id FROM bank_movements WHERE created_by=$1)",
      [user],
    );
    await db.query("DELETE FROM bank_movements WHERE created_by=$1", [user]);
    await db.query("DELETE FROM app_users WHERE id=$1", [user]);
    await db.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
