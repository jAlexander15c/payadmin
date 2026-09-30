import { readdir, readFile } from "node:fs/promises";
import { database, transaction } from "../src/lib/db";
async function main() {
  await transaction(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(481511)");
    await c.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    for (const name of (await readdir("migrations"))
      .filter((n) => n.endsWith(".sql"))
      .sort()) {
      if (
        (await c.query("SELECT 1 FROM schema_migrations WHERE name=$1", [name]))
          .rowCount
      )
        continue;
      await c.query(await readFile(`migrations/${name}`, "utf8"));
      await c.query("INSERT INTO schema_migrations(name) VALUES($1)", [name]);
      console.log(`Migración aplicada: ${name}`);
    }
  });
  await database().end();
}
main().catch(() => {
  console.error(
    "No se pudo migrar PostgreSQL. Comprueba DATABASE_URL, acceso y permisos.",
  );
  process.exitCode = 1;
});
