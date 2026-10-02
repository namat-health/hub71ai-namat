import { getPostgresPool } from "@/lib/db";
import { decisionResponse } from "@/lib/portal-backend.mjs";
export const runtime = "nodejs";
export async function POST(request, context) {
  return decisionResponse(request, context.params, {
    getPool: getPostgresPool,
  });
}
