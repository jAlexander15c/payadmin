import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { database } from "../src/lib/db";

async function main() {
  if (
    !process.env.DATABASE_URL ||
    !new URL(process.env.DATABASE_URL).pathname.endsWith("_test")
  )
    throw new Error("Usa una base aislada terminada en _test.");
  const code = process.env.INITIAL_SETUP_TOKEN;
  if (!code || code.length < 32)
    throw new Error(
      "El servidor y esta prueba requieren el mismo INITIAL_SETUP_TOKEN temporal.",
    );
  const base = process.env.TEST_BASE_URL || "http://localhost:3001",
    email = `registration-${randomBytes(8).toString("hex")}@payadmin.invalid`,
    password = randomBytes(24).toString("base64url");
  if ((await database().query("SELECT 1 FROM app_users LIMIT 1")).rowCount)
    throw new Error(
      "La base test debe estar sin usuarios; no se eliminan cuentas existentes.",
    );
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  try {
    await database().query(
      "DELETE FROM login_attempts WHERE key='initial_setup'",
    );
    const page = await browser.newPage({
        viewport: { width: 1280, height: 1000 },
      }),
      errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base + "/login");
    await page
      .getByRole("link", { name: "Crear mi cuenta", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Crea tu cuenta privada" })
      .waitFor();
    assert.ok(!(await page.content()).includes(code));
    assert.equal(
      (await page.request.get(base + "/api/snapshot")).status(),
      401,
    );
    const csrf = await page.request.post(base + "/api/initial-registration", {
      headers: { Origin: "https://other.invalid" },
      data: { code, email, password, confirmation: password },
    });
    assert.equal(csrf.status(), 403);
    await mkdir(".local/prototype", { recursive: true });
    await page.screenshot({
      path: ".local/prototype/registro.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      ),
      false,
    );
    await page.screenshot({
      path: ".local/prototype/registro-mobile.png",
      fullPage: true,
    });
    await page.getByLabel("Código de creación").fill("incorrect-code");
    await page.getByLabel("Correo electrónico").fill(email);
    await page.getByLabel("Contraseña", { exact: true }).fill(password);
    await page
      .getByLabel("Confirmar contraseña")
      .fill("does-not-match-the-password");
    await page.getByRole("button", { name: "Crear mi cuenta" }).click();
    await page
      .getByRole("alert")
      .filter({ hasText: "Las contraseñas no coinciden." })
      .waitFor();
    await page.getByLabel("Confirmar contraseña").fill(password);
    await page.getByRole("button", { name: "Crear mi cuenta" }).click();
    await page
      .getByRole("alert")
      .filter({ hasText: "El código de creación no es válido." })
      .waitFor();
    assert.equal(
      (await database().query("SELECT 1 FROM app_users")).rowCount,
      0,
    );
    await page.getByLabel("Código de creación").fill(code);
    await page.getByRole("button", { name: "Crear mi cuenta" }).click();
    await page.waitForURL(base + "/login?created=1");
    await page
      .getByRole("status")
      .filter({ hasText: "Tu cuenta fue creada." })
      .waitFor();
    assert.equal(
      await page
        .getByRole("link", { name: "Crear mi cuenta", exact: true })
        .count(),
      0,
    );
    const second = await page.request.post(base + "/api/initial-registration", {
      headers: { Origin: base },
      data: {
        code,
        email: "second@payadmin.invalid",
        password,
        confirmation: password,
      },
    });
    assert.equal(second.status(), 409);
    await page.goto(base + "/registro");
    await page
      .getByRole("heading", { name: "Tu cuenta ya está creada" })
      .waitFor();
    assert.equal(await page.locator("form").count(), 0);
    await page.getByRole("link", { name: "Ir a iniciar sesión" }).click();
    await page.getByLabel("Correo electrónico").fill(email);
    await page.getByLabel("Contraseña").fill(password);
    await page.getByRole("button", { name: "Entrar a PayAdmin" }).click();
    await page.waitForURL(base + "/");
    await page.getByRole("heading", { name: "Hola, Javier." }).waitFor();
    const d = await (await page.request.get(base + "/api/snapshot")).json();
    assert.equal(d.real.paid, 0);
    assert.equal(d.totals.capital, 1815000);
    const cookies = await page.context().cookies();
    assert.ok(
      cookies.some(
        (c) =>
          c.name === "payadmin_session" &&
          c.httpOnly &&
          c.sameSite === "Strict",
      ),
    );
    assert.deepEqual(errors, []);
    console.log(
      "Registro web: código privado, validación, CSRF, cuenta única, cierre automático, login, sesión y móvil: OK.",
    );
  } finally {
    await browser.close();
    await database().query(
      "DELETE FROM audit_log WHERE entity='user' AND user_id IN (SELECT id FROM app_users WHERE email=$1)",
      [email],
    );
    await database().query("DELETE FROM app_users WHERE email=$1", [email]);
    await database().query(
      "DELETE FROM login_attempts WHERE key IN ('initial_setup','global')",
    );
    await database().end();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
