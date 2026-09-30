import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { database } from "../../src/lib/db";
import { HttpError, verifyPassword } from "../../src/lib/auth";
import {
  initialRegistrationState,
  registerInitialUser,
} from "../../src/lib/initial-registration";
const code = randomBytes(32).toString("base64url"),
  password = randomBytes(24).toString("base64url"),
  savedCode = process.env.INITIAL_SETUP_TOKEN;
let safeToClean = false;
const input = (email = "initial@payadmin.invalid") => ({
  code,
  email,
  password,
  confirmation: password,
});
const http = (status: number) => (e: unknown) =>
  e instanceof HttpError && e.status === status;
async function clearCreatedUsers() {
  await database().query(
    "DELETE FROM audit_log WHERE entity='user' AND user_id IN (SELECT id FROM app_users WHERE email LIKE '%@payadmin.invalid')",
  );
  await database().query(
    "DELETE FROM app_users WHERE email LIKE '%@payadmin.invalid'",
  );
  await database().query(
    "DELETE FROM login_attempts WHERE key='initial_setup'",
  );
}
before(async () => {
  if (
    !process.env.DATABASE_URL ||
    !new URL(process.env.DATABASE_URL).pathname.endsWith("_test")
  )
    throw new Error(
      "El registro se prueba exclusivamente en una base aislada terminada en _test.",
    );
  if ((await database().query("SELECT 1 FROM app_users LIMIT 1")).rowCount)
    throw new Error(
      "La base de registro test debe estar sin usuarios; no se borran cuentas existentes.",
    );
  safeToClean = true;
});
after(async () => {
  if (safeToClean) await clearCreatedUsers();
  if (savedCode === undefined) delete process.env.INITIAL_SETUP_TOKEN;
  else process.env.INITIAL_SETUP_TOKEN = savedCode;
  await database().end();
});
test("Creación inicial privada desde la web", async (t) => {
  await t.test(
    "Sin código configurado, o con uno corto, el registro está deshabilitado",
    async () => {
      delete process.env.INITIAL_SETUP_TOKEN;
      assert.equal(await initialRegistrationState(), "disabled");
      await assert.rejects(() => registerInitialUser(input()), http(403));
      process.env.INITIAL_SETUP_TOKEN = "too-short";
      assert.equal(await initialRegistrationState(), "disabled");
      await assert.rejects(() => registerInitialUser(input()), http(403));
      process.env.INITIAL_SETUP_TOKEN = code;
      assert.equal(await initialRegistrationState(), "available");
    },
  );
  await t.test(
    "Código incorrecto y contraseñas inválidas no crean cuentas",
    async () => {
      await assert.rejects(
        () => registerInitialUser({ ...input(), code: "wrong" }),
        http(403),
      );
      await assert.rejects(() =>
        registerInitialUser({
          ...input(),
          password: "short",
          confirmation: "short",
        }),
      );
      await assert.rejects(() =>
        registerInitialUser({ ...input(), confirmation: "different" }),
      );
      await assert.rejects(() =>
        registerInitialUser({ ...input(), unexpected: true }),
      );
      assert.equal(
        (await database().query("SELECT count(*) AS n FROM app_users")).rows[0]
          .n,
        "0",
      );
      assert.equal(
        (
          await database().query(
            "SELECT attempts FROM login_attempts WHERE key='initial_setup'",
          )
        ).rows[0].attempts,
        4,
      );
    },
  );
  await t.test(
    "Límite de intentos persistente; se recupera tras quince minutos",
    async () => {
      await database().query(
        "DELETE FROM login_attempts WHERE key='initial_setup'",
      );
      for (let i = 0; i < 10; i++)
        await assert.rejects(
          () => registerInitialUser({ ...input(), code: "wrong" }),
          http(403),
        );
      await assert.rejects(() => registerInitialUser(input()), http(429));
      await database().query(
        "UPDATE login_attempts SET window_start=now()-interval '16 minutes' WHERE key='initial_setup'",
      );
      await assert.rejects(
        () => registerInitialUser({ ...input(), code: "wrong" }),
        http(403),
      );
      assert.equal(
        (
          await database().query(
            "SELECT attempts FROM login_attempts WHERE key='initial_setup'",
          )
        ).rows[0].attempts,
        1,
      );
      await database().query(
        "DELETE FROM login_attempts WHERE key='initial_setup'",
      );
    },
  );
  await t.test(
    "Solicitudes simultáneas crean una cuenta y guardan solo su hash",
    async () => {
      const results = await Promise.allSettled([
        registerInitialUser(input("FIRST@payadmin.invalid")),
        registerInitialUser(input("second@payadmin.invalid")),
      ]);
      assert.equal(
        results.filter((r) => r.status === "fulfilled").length,
        1,
        results
          .filter((r) => r.status === "rejected")
          .map((r) =>
            r.status === "rejected"
              ? `${r.reason.code || r.reason.name}: ${r.reason.message}`
              : "",
          )
          .join("; "),
      );
      assert.equal(
        results.filter((r) => r.status === "rejected" && http(409)(r.reason))
          .length,
        1,
      );
      const users = (
        await database().query("SELECT email,password_hash FROM app_users")
      ).rows;
      assert.equal(users.length, 1);
      assert.equal(users[0].email, users[0].email.toLowerCase());
      assert.equal(
        await verifyPassword(password, users[0].password_hash),
        true,
      );
      assert.notEqual(users[0].password_hash, password);
      const audit = JSON.stringify(
        (await database().query("SELECT * FROM audit_log WHERE entity='user'"))
          .rows,
      );
      assert.ok(audit.includes("initial_web_registration"));
      assert.ok(!audit.includes(code));
      assert.ok(!audit.includes(password));
    },
  );
  await t.test(
    "Cuenta existente cierra registro incluso con el código presente",
    async () => {
      assert.equal(await initialRegistrationState(), "closed");
      await assert.rejects(() => registerInitialUser(input()), http(409));
      delete process.env.INITIAL_SETUP_TOKEN;
      assert.equal(await initialRegistrationState(), "closed");
      await assert.rejects(() => registerInitialUser(input()), http(403));
      assert.equal(
        (await database().query("SELECT count(*) AS n FROM app_users")).rows[0]
          .n,
        "1",
      );
    },
  );
});
