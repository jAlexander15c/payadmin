import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { chromium, type Page } from "@playwright/test";
import { database } from "../src/lib/db";
import { passwordHash } from "../src/lib/auth";

async function readable(page: Page, selectors: string[]) {
  const results = await page.evaluate((selectors) => {
    const rgb = (value: string) =>
      value
        .match(/[\d.]+/g)!
        .slice(0, 3)
        .map(Number);
    const luminance = (value: string) =>
      rgb(value)
        .map((v) => v / 255)
        .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
        .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
    return selectors.flatMap((selector) =>
      [...document.querySelectorAll<HTMLElement>(selector)]
        .filter((el) => el.getBoundingClientRect().width > 0)
        .map((el) => {
          let parent: Element | null = el;
          let background = "rgba(0, 0, 0, 0)";
          while (parent) {
            background = getComputedStyle(parent).backgroundColor;
            if (background !== "rgba(0, 0, 0, 0)") break;
            parent = parent.parentElement;
          }
          const foreground =
            el instanceof SVGElement
              ? getComputedStyle(el).fill
              : getComputedStyle(el).color;
          const a = luminance(foreground),
            b = luminance(background);
          return {
            selector,
            ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
          };
        }),
    );
  }, selectors);
  assert.ok(results.length > 0);
  for (const r of results)
    assert.ok(r.ratio >= 4.5, `${r.selector}: contraste ${r.ratio.toFixed(2)}`);
}
async function main() {
  if (
    !process.env.DATABASE_URL ||
    !/_(dev|test)$/.test(new URL(process.env.DATABASE_URL).pathname)
  )
    throw new Error("Usa una BD aislada _dev o _test para la prueba visual.");
  const base = process.env.TEST_BASE_URL || "http://localhost:3000",
    id = randomUUID(),
    email = `theme-${id}@payadmin.invalid`,
    password = randomBytes(24).toString("base64url");
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  try {
    await database().query(
      "INSERT INTO app_users(id,email,password_hash) VALUES($1,$2,$3)",
      [id, email, await passwordHash(password)],
    );
    await mkdir(".local/prototype", { recursive: true });
    const context = await browser.newContext({
        viewport: { width: 1512, height: 1250 },
      }),
      page = await context.newPage(),
      errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    // tsx preserves callback names with this helper when serializing page.evaluate.
    await page.addInitScript("globalThis.__name = (target) => target;");
    await page.goto(base + "/login");
    assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
    await readable(page, [
      ".login-card h2",
      ".login-card label",
      ".login-card > p",
      ".button.primary",
    ]);
    await page.screenshot({
      path: ".local/prototype/login-dark.png",
      fullPage: true,
    });
    await page.getByRole("button", { name: "Activar modo claro" }).click();
    await page.reload();
    assert.equal(
      await page.locator("html").getAttribute("data-theme"),
      "light",
    );
    assert.equal(
      await page.evaluate(() => localStorage.getItem("payadmin_theme")),
      "light",
    );
    await page.getByRole("button", { name: "Activar modo oscuro" }).click();
    await page.getByLabel("Correo electrónico").fill(email);
    await page.getByLabel("Contraseña").fill(password);
    await page.getByRole("button", { name: "Entrar a PayAdmin" }).click();
    await page.waitForURL(base + "/");
    await page.getByRole("heading", { name: "Hola, Javier." }).waitFor();
    const checkOverflow = async () =>
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth,
        ),
        false,
      );
    const nav = (name: string) =>
      page.locator("aside").getByRole("button", { name, exact: true }).click();
    for (const theme of ["dark", "light"] as const) {
      if ((await page.locator("html").getAttribute("data-theme")) !== theme)
        await page.locator(".theme-toggle").click();
      await nav("Resumen");
      await readable(page, [
        ".metric > strong",
        ".metric-top",
        ".metric > small",
        ".source-icon.credi",
        ".balance-chart text",
        ".button.primary",
      ]);
      await checkOverflow();
      await page.screenshot({
        path: `.local/prototype/desktop-${theme}.png`,
        fullPage: true,
      });
      for (const name of [
        "Movimientos",
        "Responsabilidades",
        "Proyecciones",
        "Mi presupuesto",
        "Controles de cuadre",
        "Historial y auditoría",
        "Configuración",
      ]) {
        await nav(name);
        await checkOverflow();
        if (theme === "dark") {
          const backgrounds = await page
            .locator(".panel")
            .evaluateAll((els) =>
              els.map((el) => getComputedStyle(el).backgroundColor),
            );
          assert.ok(backgrounds.every((bg) => bg !== "rgb(255, 255, 255)"));
        }
      }
      await nav("Resumen");
      await page
        .getByRole("button", { name: "Registrar movimiento", exact: true })
        .click();
      await page.getByRole("dialog").waitFor();
      await readable(page, [
        ".modal label",
        ".modal input",
        ".modal-footer .button.primary",
      ]);
      if (theme === "dark")
        await page.screenshot({
          path: ".local/prototype/formulario-dark.png",
          fullPage: true,
        });
      await page.getByRole("button", { name: "Cerrar formulario" }).click();
    }
    await page.getByRole("button", { name: "Activar modo oscuro" }).click();
    await page.reload();
    assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
    const second = await page.context().newPage();
    await second.goto(base + "/login");
    await second.getByRole("button", { name: "Activar modo claro" }).click();
    await page.getByRole("button", { name: "Activar modo oscuro" }).waitFor();
    await second.close();
    await page.getByRole("button", { name: "Activar modo oscuro" }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    await checkOverflow();
    await page.screenshot({
      path: ".local/prototype/iphone-dark.png",
      fullPage: true,
    });
    await page.getByRole("button", { name: "Abrir navegación" }).click();
    await nav("Controles de cuadre");
    await checkOverflow();
    const toggle = await page.locator(".theme-toggle").boundingBox();
    assert.ok(toggle && toggle.x + toggle.width <= 390);
    await page.goto(base + "/registro");
    assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
    assert.deepEqual(errors, []);
    const restricted = await browser.newContext();
    await restricted.addInitScript("globalThis.__name = (target) => target;");
    await restricted.addInitScript(() => {
      Object.defineProperty(Storage.prototype, "getItem", {
        value: () => {
          throw new Error("Storage blocked");
        },
      });
      Object.defineProperty(Storage.prototype, "setItem", {
        value: () => {
          throw new Error("Storage blocked");
        },
      });
    });
    const blocked = await restricted.newPage();
    const blockedErrors: string[] = [];
    blocked.on("pageerror", (e) => blockedErrors.push(e.message));
    await blocked.goto(base + "/login");
    await blocked.getByRole("button", { name: "Activar modo claro" }).click();
    assert.equal(
      await blocked.locator("html").getAttribute("data-theme"),
      "light",
    );
    assert.deepEqual(blockedErrors, []);
    await restricted.close();
    console.log(
      "Temas: oscuro predeterminado, preferencia persistente, sincronización de pestañas, contraste de texto, todas las secciones, formularios, móvil y almacenamiento bloqueado: OK.",
    );
  } finally {
    await browser.close();
    await database().query("DELETE FROM app_users WHERE id=$1", [id]);
    await database().end();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
