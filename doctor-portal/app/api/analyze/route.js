import { portalJson, requirePortalSession } from "@/lib/portal-access.mjs";
export const runtime = "nodejs";
// Retire the unbudgeted PDF-only prototype. Every model request now needs a
// stored case, the shared spend reservation and evidence-checked interpretation.
export async function POST(request) {
  const denied = requirePortalSession(request);
  if (denied) return denied;
  return portalJson(
    {
      error:
        "Open the stored patient case to create an evidence-linked analysis.",
      code: "use_case_analysis",
    },
    410,
  );
}
