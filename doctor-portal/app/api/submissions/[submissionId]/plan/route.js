import { getPostgresPool } from "@/lib/db";
import { planResponse } from "@/lib/portal-backend.mjs";

export const runtime = "nodejs";

export async function POST(request, context) {
  return planResponse(request, context.params, { getPool: getPostgresPool });
}
