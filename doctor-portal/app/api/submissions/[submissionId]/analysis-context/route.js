import { getPostgresPool } from "@/lib/db";
import { analysisContextResponse } from "@/lib/portal-backend.mjs";
export const runtime = "nodejs";
export async function GET(request, context) {
  return analysisContextResponse(request, context.params, {
    getPool: getPostgresPool,
  });
}
