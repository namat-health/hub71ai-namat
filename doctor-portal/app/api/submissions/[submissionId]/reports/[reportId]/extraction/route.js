import { getPostgresPool } from "@/lib/db";
import { extractionResponse } from "@/lib/portal-backend.mjs";

export const runtime = "nodejs";

export async function GET(request, context) {
  return extractionResponse(request, context.params, {
    getPool: getPostgresPool,
  });
}
