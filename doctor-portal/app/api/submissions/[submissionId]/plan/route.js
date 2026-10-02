import { getPostgresPool } from "@/lib/db";
import { planResponse, savedPlanResponse } from "@/lib/portal-backend.mjs";

export const runtime = "nodejs";
export const maxDuration = 240;

export async function POST(request, context) {
  return planResponse(request, context.params, { getPool: getPostgresPool });
}

export async function GET(request, context) {
  return savedPlanResponse(request, context.params, {
    getPool: getPostgresPool,
  });
}
