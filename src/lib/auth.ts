import { cookies } from "next/headers";
import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { database, transaction } from "./db";
const scrypt = promisify(scryptCallback);
export const COOKIE = "payadmin_session";
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export async function passwordHash(password: string) {
  const salt = randomBytes(16).toString("hex");
  const key = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt}:${key.toString("hex")}`;
}
export async function verifyPassword(password: string, stored: string) {
  const [, salt, expected] = stored.split(":");
  if (!salt || !expected) return false;
  const key = (await scrypt(password, salt, 64)) as Buffer;
  const actual = Buffer.from(expected, "hex");
  return key.length === actual.length && timingSafeEqual(key, actual);
}
export async function currentUser() {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const r = await database().query(
    "SELECT u.id,u.email FROM sessions s JOIN app_users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()",
    [hash(token)],
  );
  return (r.rows[0] as { id: string; email: string } | undefined) || null;
}
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function requireUser() {
  const u = await currentUser();
  if (!u) throw new HttpError(401, "Debes iniciar sesión.");
  return u;
}
export function checkOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const url = process.env.APP_URL;
  if (!url)
    throw new HttpError(
      503,
      "Falta APP_URL para proteger las operaciones del servidor.",
    );
  if (!origin || origin !== new URL(url).origin)
    throw new HttpError(403, "Origen de la solicitud no permitido.");
}
export async function login(email: string, password: string) {
  const key = hash(email.toLowerCase());
  const allowed = await transaction(async (c) => {
    // Row lock + atomic upsert prevent concurrent attempts bypassing the limit.
    const r = await c.query(
      `INSERT INTO login_attempts(key,attempts,window_start) VALUES($1,1,now())
   ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN login_attempts.window_start < now()-interval '15 minutes' THEN 1 ELSE login_attempts.attempts+1 END,
   window_start=CASE WHEN login_attempts.window_start < now()-interval '15 minutes' THEN now() ELSE login_attempts.window_start END RETURNING attempts`,
      [key],
    );
    const g =
      await c.query(`INSERT INTO login_attempts(key,attempts,window_start) VALUES('global',1,now())
   ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN login_attempts.window_start < now()-interval '15 minutes' THEN 1 ELSE login_attempts.attempts+1 END,
   window_start=CASE WHEN login_attempts.window_start < now()-interval '15 minutes' THEN now() ELSE login_attempts.window_start END RETURNING attempts`);
    return r.rows[0].attempts <= 10 && g.rows[0].attempts <= 100;
  });
  if (!allowed)
    throw new HttpError(429, "Demasiados intentos. Espera 15 minutos.");
  const r = await database().query(
    "SELECT id,password_hash FROM app_users WHERE email=$1",
    [email.toLowerCase()],
  );
  const dummy = "scrypt:0123456789abcdef0123456789abcdef:" + "00".repeat(64);
  const valid = await verifyPassword(
    password,
    r.rows[0]?.password_hash || dummy,
  );
  if (!valid || !r.rows.length)
    throw new HttpError(401, "Correo o contraseña incorrectos.");
  const token = randomBytes(32).toString("hex");
  await transaction(async (c) => {
    await c.query("DELETE FROM login_attempts WHERE key=$1", [key]);
    await c.query("DELETE FROM sessions WHERE expires_at<now()");
    await c.query(
      "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '14 days')",
      [hash(token), r.rows[0].id],
    );
  });
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE !== "false",
    sameSite: "strict",
    path: "/",
    maxAge: 14 * 86400,
  });
}
export async function logout() {
  const token = (await cookies()).get(COOKIE)?.value;
  if (token)
    await database().query("DELETE FROM sessions WHERE token_hash=$1", [
      hash(token),
    ]);
  (await cookies()).delete(COOKIE);
}
