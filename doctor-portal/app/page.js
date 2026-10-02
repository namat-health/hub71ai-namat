import { headers } from "next/headers";
import ReviewWorkspace from "@/components/portal/ReviewWorkspace";
import { principalName, requirePortalSession } from "@/lib/portal-access.mjs";

// Display only: every data route checks the Microsoft session again.
async function clinicianName() {
  try {
    const incoming = await headers();
    const request = new Request(
      `https://${incoming.get("host") || "localhost"}/`,
      { headers: new Headers(incoming) },
    );
    return requirePortalSession(request) ? null : principalName(request);
  } catch {
    return null;
  }
}

export default async function Home() {
  return <ReviewWorkspace clinician={await clinicianName()} />;
}
