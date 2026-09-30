import pg from "pg";
import { readFileSync } from "node:fs";
const globalDb = globalThis as unknown as { payadminPool?: pg.Pool };
export function database() {
  if (!process.env.DATABASE_URL)
    throw new Error(
      "Falta DATABASE_URL. Configura PostgreSQL antes de continuar.",
    );
  if (!globalDb.payadminPool) {
    const url = new URL(process.env.DATABASE_URL);
    const mode =
      process.env.DATABASE_SSL ||
      (url.searchParams.has("sslmode") &&
      url.searchParams.get("sslmode") !== "disable"
        ? "verify"
        : "disable");
    if (!["disable", "verify"].includes(mode))
      throw new Error("DATABASE_SSL debe ser disable o verify.");
    // SSL configuration stays explicit. Never use rejectUnauthorized:false.
    for (const key of ["sslmode", "sslcert", "sslkey", "sslrootcert"])
      url.searchParams.delete(key);
    globalDb.payadminPool = new pg.Pool({
      connectionString: url.toString(),
      max: 8,
      connectionTimeoutMillis: 10000,
      ssl:
        mode === "verify"
          ? {
              rejectUnauthorized: true,
              ...(process.env.DATABASE_CA_FILE
                ? { ca: readFileSync(process.env.DATABASE_CA_FILE, "utf8") }
                : {}),
            }
          : false,
    });
  }
  return globalDb.payadminPool;
}
export async function transaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const c = await database().connect();
  try {
    await c.query("BEGIN");
    const r = await fn(c);
    await c.query("COMMIT");
    return r;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
