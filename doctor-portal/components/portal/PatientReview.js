import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { evidenceLink } from "@/lib/clinical/evidence-links.mjs";
import { mergeReportLabs } from "@/lib/lab-values.mjs";
import {
  contextSentence,
  hasQuestionnaireRow,
  profileLine,
  questionnaireGroups,
} from "@/lib/questionnaire.mjs";
import evidenceStyles from "./ClinicalEvidence.module.css";
import LabReportCard from "./LabReportCard";
import PatientEmail from "./PatientEmail";
import PatientSummary from "./PatientSummary";
import PlanCard from "./PlanCard";
import PlanModal from "./PlanModal";
import QuestionnaireDrawer from "./QuestionnaireDrawer";
import styles from "./Workspace.module.css";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const POLL_MS = 8000;
const POLL_LIMIT = 15;
const HIGHLIGHT_MS = 4500;
const SAVE_ERROR = "The value couldn’t be saved. Please try again.";
const CHANGED =
  "This value changed in the meantime. The latest reading is shown; check it again.";

// What Namat read from each stored report. Reports still being processed are
// checked again for a couple of minutes. A save returns the new values for
// its report; a conflict reloads them all.
function useExtractions(submissionId, reports) {
  const [state, setState] = useState({});
  const [reloads, setReloads] = useState(0);
  const ids = reports.map((report) => report.id).join(",");
  useEffect(() => {
    void reloads;
    const controller = new AbortController();
    const timers = [];
    const load = async (reportId, polls) => {
      try {
        const response = await fetch(
          `/api/submissions/${encodeURIComponent(submissionId)}/reports/${encodeURIComponent(reportId)}/extraction`,
          {
            cache: "no-store",
            credentials: "same-origin",
            signal: controller.signal,
          },
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(String(response.status));
        setState((current) => ({
          ...current,
          [reportId]: { state: "ready", data },
        }));
        if (
          !data.extraction &&
          ["queued", "processing"].includes(data.status) &&
          polls < POLL_LIMIT
        )
          timers.push(setTimeout(() => load(reportId, polls + 1), POLL_MS));
      } catch {
        if (!controller.signal.aborted)
          setState((current) => ({
            ...current,
            [reportId]: { state: "error" },
          }));
      }
    };
    for (const reportId of ids.split(",").filter(Boolean)) {
      if (UUID.test(reportId)) load(reportId, 0);
      else
        setState((current) => ({
          ...current,
          [reportId]: { state: "unsupported" },
        }));
    }
    return () => {
      controller.abort();
      for (const timer of timers) clearTimeout(timer);
    };
  }, [submissionId, ids, reloads]);
  const replace = useCallback((reportId, data) => {
    setState((current) => ({
      ...current,
      [reportId]: { state: "ready", data },
    }));
  }, []);
  const reload = useCallback(() => setReloads((value) => value + 1), []);
  return { extractions: state, replace, reload };
}

export default function PatientReview({
  patient,
  planState,
  onCreatePlan,
  onToggleTest,
  onDecision,
  onEvidenceChange,
}) {
  const { submission, name } = patient;
  const reports = useMemo(
    () => submission.attached_reports.filter((report) => report.sourceUrl),
    [submission],
  );
  const {
    extractions,
    replace: replaceExtraction,
    reload: reloadExtractions,
  } = useExtractions(submission.id, reports);
  const labs = useMemo(
    () =>
      mergeReportLabs(
        reports.map(
          (report) => extractions[report.id]?.data?.extraction?.labs || [],
        ),
      ),
    [reports, extractions],
  );

  const [labView, setLabView] = useState("original");
  const [pages, setPages] = useState(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [focus, setFocus] = useState(null);
  const [jump, setJump] = useState(null);
  const [drawer, setDrawer] = useState({ open: false, key: null });
  const [modal, setModal] = useState(null);
  const [expanded, setExpanded] = useState(() => new Set());
  const [rowFocus, setRowFocus] = useState(null);
  const confirmCursor = useRef(0);
  const inventoryLoad = useRef(null);
  const [inventory, setInventory] = useState({
    reviews: [],
    pending: null,
    error: null,
  });
  const inventoryVersion = reports
    .map((report) => {
      const data = extractions[report.id]?.data;
      return `${report.id}:${data?.extraction?.id || ""}:${data?.revision ?? ""}`;
    })
    .join("|");
  useEffect(() => {
    void inventoryVersion;
    const controller = new AbortController();
    inventoryLoad.current = controller;
    fetch(
      `/api/submissions/${encodeURIComponent(submission.id)}/report-inventory`,
      {
        credentials: "same-origin",
        cache: "no-store",
        signal: controller.signal,
      },
    )
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !Array.isArray(data.reviews))
          throw new Error(
            typeof data.error === "string"
              ? data.error
              : "Report coverage reviews could not be loaded.",
          );
        if (!controller.signal.aborted)
          setInventory((current) => ({
            ...current,
            reviews: data.reviews,
            error: null,
          }));
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setInventory((current) => ({ ...current, error: error.message }));
      });
    return () => controller.abort();
  }, [submission.id, inventoryVersion]);

  const confirmInventory = async (report) => {
    const data = extractions[report.id]?.data;
    if (!data?.extraction || inventory.pending) return;
    inventoryLoad.current?.abort();
    const review = {
      reportId: report.id,
      extractionId: data.extraction.id,
      reviewRevision: data.revision ?? data.reviewRevision ?? 0,
      confirmed: true,
    };
    setInventory((current) => ({
      ...current,
      pending: report.id,
      error: null,
    }));
    try {
      const response = await fetch(
        `/api/submissions/${encodeURIComponent(submission.id)}/report-inventory`,
        {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(review),
        },
      );
      const result = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(
          typeof result.error === "string"
            ? result.error
            : "Report coverage could not be saved.",
        );
      setInventory((current) => ({
        ...current,
        pending: null,
        reviews: [
          ...current.reviews.filter((item) => item.reportId !== report.id),
          result.review || review,
        ],
      }));
      onEvidenceChange?.();
    } catch (error) {
      setInventory((current) => ({
        ...current,
        pending: null,
        error: error.message,
      }));
    }
  };

  useEffect(() => {
    document.title = `${name} · Namat`;
  }, [name]);

  // A new plan starts with every finding folded.
  const plan = planState.status === "ready" ? planState.plan : null;
  useEffect(() => {
    if (plan) setExpanded(new Set());
  }, [plan]);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key !== "Escape") return;
      if (drawer.open) setDrawer((current) => ({ ...current, open: false }));
      else if (modal && !planState.decisionSaving) setModal(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawer.open, modal, planState.decisionSaving]);

  // Pages of every report in order, so "page 3" means the same thing in the
  // viewer and in the parsed list.
  const pageNumber = useCallback(
    (lab) => {
      const index = pages
        ? pages.findIndex(
            (page) => page.reportId === lab.reportId && page.page === lab.page,
          )
        : -1;
      if (index >= 0) return index + 1;
      let offset = 0;
      for (const report of reports) {
        if (report.id === lab.reportId) break;
        offset += extractions[report.id]?.data?.pageCount || 1;
      }
      return offset + lab.page;
    },
    [pages, reports, extractions],
  );

  const locate = useCallback((lab) => {
    const at = Date.now();
    setLabView("original");
    setFocus({
      id: lab.id,
      reportId: lab.reportId,
      page: lab.page,
      bbox: lab.bbox,
      at,
      fading: false,
    });
    setJump({ reportId: lab.reportId, page: lab.page, at });
  }, []);

  // Go to the located page once, including when the report is still loading.
  // The highlight fading out must not pull the doctor back to this page.
  useEffect(() => {
    if (!jump || !pages) return;
    const index = pages.findIndex(
      (page) => page.reportId === jump.reportId && page.page === jump.page,
    );
    if (index >= 0) setPageIndex(index);
    setJump(null);
  }, [jump, pages]);

  useEffect(() => {
    if (!focus || focus.fading) return;
    const timer = setTimeout(
      () =>
        setFocus((current) =>
          current?.at === focus.at ? { ...current, fading: true } : current,
        ),
      HIGHLIGHT_MS,
    );
    return () => clearTimeout(timer);
  }, [focus]);

  const toConfirm = labs.filter((lab) => lab.note);
  const locateNextToConfirm = () => {
    if (!toConfirm.length) return;
    locate(toConfirm[confirmCursor.current % toConfirm.length]);
    confirmCursor.current += 1;
  };
  // The plan waits for flagged values: take the doctor to the first one.
  const showValueToConfirm = () => {
    if (!toConfirm.length) return;
    setLabView("parsed");
    setRowFocus({ id: toConfirm[0].id, at: Date.now() });
  };

  // "Looks right" or "Fix": saved as the report's next review, which returns
  // the report's new values. A conflict means someone changed it meanwhile.
  const saveValue = useCallback(
    async (lab, action, edits = {}) => {
      const data = extractions[lab.reportId]?.data;
      if (!data?.extraction) throw new Error(SAVE_ERROR);
      const response = await fetch(
        `/api/submissions/${encodeURIComponent(submission.id)}/reports/${encodeURIComponent(lab.reportId)}/confirmations`,
        {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            extractionId: data.extraction.id,
            revision: data.revision,
            index: lab.observationIndex,
            action,
            ...edits,
          }),
        },
      );
      const result = await response.json().catch(() => ({}));
      if (response.ok && result.reportId === lab.reportId) {
        replaceExtraction(lab.reportId, result);
        onEvidenceChange?.();
        return;
      }
      if (response.status === 409) {
        reloadExtractions();
        onEvidenceChange?.();
        throw new Error(CHANGED);
      }
      throw new Error(
        typeof result.error === "string" ? result.error : SAVE_ERROR,
      );
    },
    [
      extractions,
      submission.id,
      replaceExtraction,
      reloadExtractions,
      onEvidenceChange,
    ],
  );

  const openDrawer = useCallback((key) => {
    setDrawer({
      open: true,
      key: key && hasQuestionnaireRow(key) ? key : null,
      at: Date.now(),
    });
  }, []);

  const labsById = useMemo(
    () => new Map(labs.map((lab) => [lab.id, lab])),
    [labs],
  );
  const openEvidence = useCallback(
    (reference) => {
      const link = evidenceLink(planState.analysis, reference);
      if (!link) return;
      setModal(null);
      if (link.type === "questionnaire") {
        openDrawer(link.key);
        return;
      }
      if (!reports.some((report) => report.id === link.reportId)) return;
      locate(labsById.get(link.labId) || link);
    },
    [planState.analysis, reports, labsById, locate, openDrawer],
  );
  // Evidence chips for a finding. Lab chips only show for values this report
  // actually contains.
  const chipsFor = useCallback(
    (finding, { fromModal = false } = {}) =>
      finding.evidence
        .map((item, index) => {
          if (item.type === "report") {
            const link = evidenceLink(planState.analysis, item);
            if (!link || !reports.some((report) => report.id === link.reportId))
              return null;
            return {
              key: `${index}:${link.id}`,
              text: item.label,
              where: `· report page ${item.page}`,
              onClick: () => openEvidence(link.id),
            };
          }
          if (item.type === "lab") {
            const lab = labsById.get(item.labId);
            if (!lab) return null;
            return {
              key: `${index}:${item.labId}`,
              text: `${lab.short} ${lab.display}`,
              where: "· report",
              onClick: () => {
                if (fromModal) setModal(null);
                locate(lab);
              },
            };
          }
          if (item.type !== "questionnaire") return null;
          return {
            key: `${index}:${item.key}`,
            text: item.label,
            where: "· questionnaire",
            onClick: () => {
              if (fromModal) setModal(null);
              openDrawer(item.key);
            },
          };
        })
        .filter(Boolean),
    [labsById, locate, openDrawer, planState.analysis, reports, openEvidence],
  );

  const reading = reports.some(
    (report) => !extractions[report.id] && UUID.test(report.id),
  );
  return (
    <main className={styles.main}>
      <LabReportCard
        reports={reports}
        extractions={extractions}
        labs={labs}
        labView={labView}
        onLabView={setLabView}
        pages={pages}
        onPages={setPages}
        pageIndex={pageIndex}
        onPageIndex={setPageIndex}
        zoom={zoom}
        onZoom={setZoom}
        focus={focus}
        toConfirm={toConfirm.length}
        onConfirm={locateNextToConfirm}
        onLocate={locate}
        onSaveValue={saveValue}
        rowFocus={rowFocus}
        pageNumber={pageNumber}
      />
      <div className={styles.column}>
        <PatientSummary
          name={name}
          profile={profileLine(submission.answers)}
          context={contextSentence(submission.answers)}
          onQuestionnaire={() => openDrawer(null)}
        />
        {reports.length > 0 && (
          <details className={evidenceStyles.inventory}>
            <summary>
              Confirm report coverage before adding missing tests
            </summary>
            <p>
              Compare the original PDF with “What Namat read”. Confirm only when
              every reported test appears in the extracted list. This records
              report completeness, not a clinical all-clear.
            </p>
            <button type="button" onClick={() => setLabView("parsed")}>
              Check extracted list
            </button>
            {reports.map((report) => {
              const data = extractions[report.id]?.data;
              const revision = data?.revision ?? data?.reviewRevision ?? 0;
              const reviewed = inventory.reviews.some(
                (item) =>
                  item.reportId === report.id &&
                  item.extractionId === data?.extraction?.id &&
                  item.reviewRevision === revision &&
                  item.confirmed !== false,
              );
              const uncertain = labs.some(
                (lab) => lab.reportId === report.id && lab.note,
              );
              return (
                <div key={report.id} className={evidenceStyles.inventoryRow}>
                  <span>{report.name || "Uploaded report"}</span>
                  {reviewed ? (
                    <strong>Coverage confirmed</strong>
                  ) : (
                    <button
                      type="button"
                      disabled={
                        !data?.extraction ||
                        Boolean(inventory.pending) ||
                        uncertain
                      }
                      onClick={() => confirmInventory(report)}
                    >
                      {inventory.pending === report.id
                        ? "Saving…"
                        : "All report values accounted for"}
                    </button>
                  )}
                </div>
              );
            })}
            {inventory.error && (
              <p className={evidenceStyles.error} role="alert">
                {inventory.error}
              </p>
            )}
          </details>
        )}
        <PlanCard
          state={planState}
          labCount={reading ? 0 : labs.length}
          expanded={expanded}
          onToggleFinding={(index) =>
            setExpanded((current) => {
              const next = new Set(current);
              if (next.has(index)) next.delete(index);
              else next.add(index);
              return next;
            })
          }
          chipsFor={chipsFor}
          toConfirm={toConfirm}
          onConfirmFirst={showValueToConfirm}
          onCreate={onCreatePlan}
          onToggleTest={onToggleTest}
          onReadPlan={() => setModal("plan")}
          onApprove={() => setModal("review")}
          onEvidence={openEvidence}
        />
        {planState.analysis?.runId &&
          planState.analysis.latestDecision?.decision === "approved" &&
          !planState.selectionChanged && (
            <PatientEmail
              key={planState.analysis.latestDecision.id}
              submissionId={submission.id}
              runId={planState.analysis.runId}
              name={submission.first_name || name}
            />
          )}
      </div>
      <PlanModal
        mode={plan ? modal : null}
        plan={plan}
        selected={planState.selected || []}
        onToggleTest={onToggleTest}
        chipsFor={chipsFor}
        patientName={name}
        analysis={planState.analysis}
        onDecision={onDecision}
        saving={planState.decisionSaving}
        decisionError={planState.decisionError}
        onEvidence={openEvidence}
        onMode={setModal}
      />
      <QuestionnaireDrawer
        open={drawer.open}
        focusKey={drawer.key}
        focusAt={drawer.at}
        name={name}
        groups={questionnaireGroups(submission)}
        onClose={() => setDrawer((current) => ({ ...current, open: false }))}
      />
    </main>
  );
}
