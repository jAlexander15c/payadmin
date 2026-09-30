import { chromium } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { database } from "../src/lib/db";
import { passwordHash } from "../src/lib/auth";
async function main() {
  if (
    !process.env.DATABASE_URL ||
    !/_(dev|test)$/.test(new URL(process.env.DATABASE_URL).pathname)
  )
    throw new Error("Las capturas deben usar una BD aislada _dev o _test.");
  const base = process.env.PROTOTYPE_BASE_URL || "http://localhost:3000";
  const user = randomUUID(),
    password = randomBytes(24).toString("base64url"),
    email = `prototype-${user}@payadmin.invalid`;
  await database().query(
    "INSERT INTO app_users(id,email,password_hash) VALUES($1,$2,$3)",
    [user, email, await passwordHash(password)],
  );
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  try {
    await mkdir(".local/prototype", { recursive: true });
    const page = await browser.newPage({
      viewport: { width: 1512, height: 1250 },
      deviceScaleFactor: 1,
    });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base + "/login");
    await page.locator("input[name=email]").fill(email);
    await page.locator("input[name=password]").fill(password);
    await page.getByRole("button", { name: "Entrar a PayAdmin" }).click();
    await page.waitForURL(base + "/");
    await page.getByRole("heading", { name: "Hola, Javier." }).waitFor();
    await page.waitForTimeout(400);
    await page.screenshot({
      path: ".local/prototype/desktop.png",
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Registrar movimiento", exact: true })
      .click();
    await page.getByRole("dialog").waitFor();
    await page.waitForTimeout(400);
    await page.screenshot({
      path: ".local/prototype/formulario.png",
      fullPage: true,
    });
    await page.getByRole("button", { name: "Cerrar formulario" }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(400);
    await page.screenshot({
      path: ".local/prototype/iphone.png",
      fullPage: true,
    });
    if (
      await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      )
    )
      throw new Error("La vista móvil tiene desbordamiento horizontal.");
    if (errors.length) throw new Error(errors.join("\n"));
    console.log(
      "Capturas generadas: escritorio, iPhone y formulario. Sin errores de navegador ni desbordamiento móvil.",
    );
  } finally {
    await browser.close();
    await database().query("DELETE FROM app_users WHERE id=$1", [user]);
    await database().end();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
