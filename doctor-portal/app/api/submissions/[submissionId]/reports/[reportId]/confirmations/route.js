import { getPostgresPool } from "@/lib/db";
import { confirmationResponse } from "@/lib/portal-backend.mjs";

export const runtime = "nodejs";

export async function POST(request, context) {
  return confirmationResponse(request, context.params, {
    getPool: getPostgresPool,
  });
}
