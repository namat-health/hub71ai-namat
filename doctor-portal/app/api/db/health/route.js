import { getPostgresPool } from "@/lib/db";
import { healthResponse } from "@/lib/portal-backend.mjs";

export const runtime = "nodejs";

export async function GET(request) {
  return healthResponse(request, { getPool: getPostgresPool });
}
