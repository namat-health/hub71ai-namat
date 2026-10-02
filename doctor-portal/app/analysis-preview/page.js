import { notFound } from "next/navigation";
import OfflineAnalysisPreview from "@/components/portal/OfflineAnalysisPreview";
import { offlinePreview } from "@/lib/clinical/offline-preview.mjs";

export const dynamic = "force-dynamic";

export default async function AnalysisPreviewPage() {
  if (
    process.env.NODE_ENV !== "development" ||
    process.env.NAMAT_OFFLINE_PREVIEW !== "true"
  )
    notFound();
  try {
    // Fixed local fictional artifact only, read after the development gate.
    // Opening this page never dispatches a model request.
    const saved = JSON.parse(
      await readFile(
        join(process.cwd(), ".clinical-evaluation", "preview.json"),
        "utf8",
      ),
    );
    if (
      saved.fictional === true &&
      saved.case === "iron_glycemia" &&
      saved.passed === true &&
      saved.analysis?.source === "openai" &&
      saved.analysis?.validation?.narrativeCheck === "passed"
    )
      return <OfflineAnalysisPreview analysis={saved.analysis} generated />;
  } catch {
    /* No evaluated artifact yet: show the clearly labelled authored fixture. */
  }
  return <OfflineAnalysisPreview analysis={offlinePreview} />;
}

import { readFile } from "node:fs/promises";
import { join } from "node:path";
