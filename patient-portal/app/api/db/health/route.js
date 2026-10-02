import { getPostgresPool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store, max-age=0" };

export async function GET() {
  try {
    await getPostgresPool().query("SELECT 1");
    return Response.json({ ok: true, database: "connected" }, { headers });
  } catch (error) {
    const notConfigured = error?.message === "DATABASE_URL is not configured.";

    return Response.json(
      {
        ok: false,
        error: notConfigured
          ? "DATABASE_URL is not configured."
          : "Could not connect to the database.",
      },
      { status: 503, headers },
    );
  }
}
