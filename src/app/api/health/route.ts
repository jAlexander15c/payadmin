import { database } from "@/lib/db";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const ready = await database().query(
      "SELECT EXISTS(SELECT 1 FROM loans WHERE id=1) AND EXISTS(SELECT 1 FROM schema_migrations WHERE name='005_fund_totals.sql') AS ready",
    );
    if (!ready.rows[0].ready) throw new Error("Esquema pendiente");
    return Response.json(
      { status: "ok" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { status: "database_pending" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
