import { randomUUID } from "node:crypto";
import { database } from "../src/lib/db";
import { passwordHash } from "../src/lib/auth";
async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase(),
    password = process.env.ADMIN_PASSWORD;
  if (
    !email ||
    !/^\S+@\S+\.\S+$/.test(email) ||
    !password ||
    password.length < 14 ||
    password.length > 256
  )
    throw new Error(
      "Proporciona ADMIN_EMAIL y ADMIN_PASSWORD (14 a 256 caracteres) únicamente a este comando.",
    );
  const h = await passwordHash(password);
  const result = await database().query(
    "INSERT INTO app_users(id,email,password_hash) VALUES($1,$2,$3) ON CONFLICT(email) DO NOTHING RETURNING id",
    [randomUUID(), email, h],
  );
  console.log(
    result.rowCount
      ? "Acceso privado creado."
      : "El usuario ya existe; su contraseña se conservó.",
  );
  await database().end();
}
main().catch((e) => {
  console.error(
    e instanceof Error && e.message.startsWith("Proporciona")
      ? e.message
      : "No se pudo crear el usuario. Comprueba la conexión y las migraciones.",
  );
  process.exitCode = 1;
});
