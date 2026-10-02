import { getPostgresPool } from "@/lib/db";
import { patientEmailResponse } from "@/lib/portal-backend.mjs";
export const runtime = "nodejs";
export async function POST(request, context) {
  return patientEmailResponse(request, context.params, {
    getPool: getPostgresPool,
  });
}
