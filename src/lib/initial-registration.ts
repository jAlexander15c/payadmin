import { randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { database, transaction } from "./db";
import { hash, HttpError, passwordHash } from "./auth";

export const initialRegistrationInput = z
  .object({
    code: z.string().min(1).max(256),
    email: z
      .email()
      .max(254)
      .transform((value) => value.toLowerCase()),
    password: z
      .string()
      .min(14, "La contraseña debe tener al menos 14 caracteres.")
      .max(256),
    confirmation: z.string().max(256),
  })
  .strict()
  .refine((value) => value.password === value.confirmation, {
    message: "Las contraseñas no coinciden.",
    path: ["confirmation"],
  });
export type RegistrationState =
  | "available"
  | "disabled"
  | "closed"
  | "database_pending";
function setupToken() {
  const value = process.env.INITIAL_SETUP_TOKEN;
  return value &&
    value.length >= 32 &&
    value.length <= 256 &&
    value.trim() === value
    ? value
    : null;
}
export async function initialRegistrationState(): Promise<RegistrationState> {
  try {
    const existing = await database().query("SELECT 1 FROM app_users LIMIT 1");
    if (existing.rowCount) return "closed";
    return setupToken() ? "available" : "disabled";
  } catch {
    return "database_pending";
  }
}
export async function registerInitialUser(raw: unknown) {
  const token = setupToken();
  if (!token)
    throw new HttpError(
      403,
      "La creación inicial de cuenta no está habilitada.",
    );
  // Persist the attempt before validation: failed requests must not roll back the counter.
  const attempts = await database()
    .query(`INSERT INTO login_attempts(key,attempts,window_start) VALUES('initial_setup',1,now())
    ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN login_attempts.window_start < now()-interval '15 minutes' THEN 1 ELSE login_attempts.attempts+1 END,
    window_start=CASE WHEN login_attempts.window_start < now()-interval '15 minutes' THEN now() ELSE login_attempts.window_start END RETURNING attempts`);
  if (attempts.rows[0].attempts > 10)
    throw new HttpError(429, "Demasiados intentos. Espera 15 minutos.");
  const v = initialRegistrationInput.parse(raw);
  if (
    !timingSafeEqual(
      Buffer.from(hash(v.code), "hex"),
      Buffer.from(hash(token), "hex"),
    )
  )
    throw new HttpError(403, "El código de creación no es válido.");
  const password = await passwordHash(v.password);
  return transaction(async (c) => {
    // Blocks concurrent browser and CLI inserts while checking the empty user table.
    await c.query("LOCK TABLE app_users IN SHARE ROW EXCLUSIVE MODE");
    if ((await c.query("SELECT 1 FROM app_users LIMIT 1")).rowCount)
      throw new HttpError(
        409,
        "Ya existe una cuenta. Inicia sesión con tu usuario.",
      );
    const id = randomUUID();
    await c.query(
      "INSERT INTO app_users(id,email,password_hash) VALUES($1,$2,$3)",
      [id, v.email, password],
    );
    await c.query(
      "INSERT INTO audit_log(user_id,entity,entity_id,action,after_data,reason) VALUES($1,'user',$2,'create',$3,'Creación inicial desde la web')",
      [
        id,
        id,
        JSON.stringify({ email: v.email, method: "initial_web_registration" }),
      ],
    );
    return { ok: true };
  });
}
