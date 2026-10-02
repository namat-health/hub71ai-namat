import { getPostgresPool } from "@/lib/db";
import { submissionsResponse } from "@/lib/portal-backend.mjs";

export const runtime = "nodejs";

export async function GET(request) {
  return submissionsResponse(request, { getPool: getPostgresPool });
}
