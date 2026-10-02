import { inventoryResponse } from "@/lib/portal-backend.mjs";
export const runtime = "nodejs";
export async function GET(request, context) {
  return inventoryResponse(request, context.params);
}
export async function POST(request, context) {
  return inventoryResponse(request, context.params);
}
