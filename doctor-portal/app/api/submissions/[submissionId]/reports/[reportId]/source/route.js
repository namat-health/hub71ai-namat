import { getPostgresPool } from "@/lib/db";
import { sourceResponse } from "@/lib/portal-backend.mjs";

export const runtime = "nodejs";

export async function GET(request, context) {
  return sourceResponse(request, context.params, { getPool: getPostgresPool });
}
