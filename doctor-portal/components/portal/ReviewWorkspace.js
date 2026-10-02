"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { assessmentRequest } from "@/lib/assessment-request.mjs";
import PatientReview from "./PatientReview";
import Rail, { MobileBar } from "./Rail";
import styles from "./Workspace.module.css";

const PLAN_ERROR = "The assessment couldn’t be created. Please try again.";
const ready = (analysis) => ({
  status: "ready",
  plan: analysis.plan,
  analysis,
  selected: (analysis.latestDecision?.selectedTestIds || []).filter((id) =>
    analysis.plan.tests.some((test) => test.id === id),
  ),
  decisionSaving: false,
  decisionError: null,
});

function createdAt(submission) {
  return Date.parse(submission.created_at) || 0;
}

// One patient per email address; the newest submission is the one reviewed.
function groupPatients(submissions) {
  const groups = new Map();
  for (const submission of submissions) {
    const email = String(submission.email || "")
      .trim()
      .toLowerCase();
    const key = email ? `email:${email}` : `submission:${submission.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(submission);
  }
  return [...groups.entries()]
    .map(([key, rows]) => {
      const latest = rows.reduce((a, b) =>
        createdAt(b) > createdAt(a) ? b : a,
      );
      return {
        key,
        name: latest.first_name?.trim() || "Unnamed patient",
        submission: latest,
      };
    })
    .sort((a, b) => createdAt(b.submission) - createdAt(a.submission));
}

export default function ReviewWorkspace({ clinician }) {
  const [submissions, setSubmissions] = useState(null);
  const [status, setStatus] = useState("loading");
  const [attempt, setAttempt] = useState(0);
  const [selectedKey, setSelectedKey] = useState(null);
  const [navOpen, setNavOpen] = useState({ queue: true, all: false });
  const [plans, setPlans] = useState({});
  const runs = useRef({});
  const plansRef = useRef({});

  useEffect(() => {
    // Re-run when the doctor asks to retry.
    void attempt;
    const controller = new AbortController();
    setStatus("loading");
    fetch("/api/submissions", {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !Array.isArray(data.submissions))
          throw new Error("unavailable");
        setSubmissions(data.submissions);
        setStatus("ready");
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus("error");
      });
    return () => controller.abort();
  }, [attempt]);

  useEffect(() => {
    const active = runs.current;
    return () => {
      for (const run of Object.values(active)) run.controller?.abort();
    };
  }, []);

  const patients = useMemo(
    () => groupPatients(submissions || []),
    [submissions],
  );
  const approved = (id) =>
    plans[id]?.analysis?.latestDecision?.decision === "approved" &&
    !plans[id]?.selectionChanged;
  const queue = patients.filter((patient) => !approved(patient.submission.id));
  const reviewed = patients.filter((patient) =>
    approved(patient.submission.id),
  );
  const active =
    patients.find((patient) => patient.key === selectedKey) ||
    queue[0] ||
    patients[0] ||
    null;
  const activeId = active?.submission.id;

  // Pin the first patient shown, so approving an assessment (which moves the patient
  // out of the queue) never switches to someone else.
  useEffect(() => {
    if (selectedKey === null && active) setSelectedKey(active.key);
  }, [selectedKey, active]);

  // Keep the open patient visible after it moves between groups.
  useEffect(() => {
    if (!activeId) return;
    const group =
      plans[activeId]?.analysis?.latestDecision?.decision === "approved"
        ? "all"
        : "queue";
    setNavOpen((open) => (open[group] ? open : { ...open, [group]: true }));
  }, [activeId, plans]);

  const setPlan = useCallback((submissionId, value) => {
    plansRef.current[submissionId] = value;
    setPlans((current) => ({ ...current, [submissionId]: value }));
  }, []);

  useEffect(() => {
    if (!activeId || plansRef.current[activeId]) return;
    const run = { controller: new AbortController() };
    runs.current[activeId] = run;
    setPlan(activeId, { status: "loading_saved" });
    assessmentRequest(`/api/submissions/${encodeURIComponent(activeId)}/plan`, {
      credentials: "same-origin",
      cache: "no-store",
      signal: run.controller.signal,
    })
      .then(({ response, data }) => {
        if (!response.ok)
          throw new Error(
            typeof data.error === "string"
              ? data.error
              : "The saved assessment could not be loaded.",
          );
        if (runs.current[activeId] !== run) return;
        setPlan(
          activeId,
          data.analysis?.plan ? ready(data.analysis) : { status: "empty" },
        );
      })
      .catch((error) => {
        if (!run.controller.signal.aborted && runs.current[activeId] === run)
          setPlan(activeId, { status: "empty", error: error.message });
      });
  }, [activeId, setPlan]);

  const createPlan = useCallback(
    async (submissionId) => {
      if (plansRef.current[submissionId]?.status === "loading") return;
      runs.current[submissionId]?.controller?.abort();
      const run = { controller: new AbortController() };
      runs.current[submissionId] = run;
      setPlan(submissionId, { status: "loading" });
      try {
        const { response, data } = await assessmentRequest(
          `/api/submissions/${encodeURIComponent(submissionId)}/plan`,
          {
            method: "POST",
            credentials: "same-origin",
            cache: "no-store",
            headers: { Accept: "application/json" },
            signal: run.controller.signal,
          },
        );
        if (!response.ok || !Array.isArray(data.plan?.tests))
          throw new Error(
            typeof data.error === "string" ? data.error : PLAN_ERROR,
          );
        if (runs.current[submissionId] === run)
          setPlan(submissionId, {
            ...ready(data),
            selected: [],
            selectionChanged: Boolean(data.latestDecision),
          });
      } catch (error) {
        if (
          !run.controller.signal.aborted &&
          runs.current[submissionId] === run
        )
          setPlan(submissionId, {
            status: "empty",
            error: error.message || PLAN_ERROR,
          });
      }
    },
    [setPlan],
  );

  const toggleTest = useCallback(
    (submissionId, testId) => {
      const state = plansRef.current[submissionId];
      if (
        state?.status !== "ready" ||
        state.decisionSaving ||
        !state.plan.tests.some((test) => test.id === testId)
      )
        return;
      setPlan(submissionId, {
        ...state,
        selected: state.selected.includes(testId)
          ? state.selected.filter((id) => id !== testId)
          : [...state.selected, testId],
        selectionChanged: true,
      });
    },
    [setPlan],
  );

  const invalidate = useCallback(
    (submissionId) => {
      runs.current[submissionId]?.controller?.abort();
      delete runs.current[submissionId];
      setPlan(submissionId, {
        status: "empty",
        notice:
          "Report evidence changed. Create a fresh assessment before recording a decision.",
      });
    },
    [setPlan],
  );

  const saveDecision = useCallback(
    async (submissionId, decision, notes) => {
      const state = plansRef.current[submissionId];
      if (
        state?.status !== "ready" ||
        !state.analysis?.runId ||
        state.decisionSaving
      )
        return false;
      setPlan(submissionId, {
        ...state,
        decisionSaving: true,
        decisionError: null,
      });
      try {
        const response = await fetch(
          `/api/submissions/${encodeURIComponent(submissionId)}/analysis-decisions`,
          {
            method: "POST",
            credentials: "same-origin",
            cache: "no-store",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({
              runId: state.analysis.runId,
              caseFingerprint: state.analysis.caseFingerprint,
              selectedTestIds: decision === "approved" ? state.selected : [],
              decision,
              notes,
            }),
          },
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.decision)
          throw new Error(
            typeof data.error === "string"
              ? data.error
              : "The review decision could not be saved.",
          );
        if (
          plansRef.current[submissionId]?.analysis?.runId !==
          state.analysis.runId
        )
          return false;
        setPlan(submissionId, {
          ...state,
          analysis: { ...state.analysis, latestDecision: data.decision },
          selected: decision === "approved" ? state.selected : [],
          selectionChanged: false,
          decisionSaving: false,
          decisionError: null,
        });
        return true;
      } catch (error) {
        if (
          plansRef.current[submissionId]?.analysis?.runId ===
          state.analysis.runId
        )
          setPlan(submissionId, {
            ...state,
            decisionSaving: false,
            decisionError: error.message,
          });
        return false;
      }
    },
    [setPlan],
  );

  return (
    <div className={styles.shell}>
      <Rail
        queue={queue}
        reviewed={reviewed}
        status={status}
        activeKey={active?.key}
        open={navOpen}
        clinician={clinician}
        onToggle={(group) =>
          setNavOpen((open) => ({ ...open, [group]: !open[group] }))
        }
        onSelect={setSelectedKey}
        onRetry={() => setAttempt((value) => value + 1)}
      />
      <MobileBar
        patients={patients}
        activeKey={active?.key}
        onSelect={setSelectedKey}
      />
      {active ? (
        <PatientReview
          key={active.submission.id}
          patient={active}
          clinician={clinician}
          planState={plans[activeId] || { status: "empty" }}
          onCreatePlan={() => createPlan(activeId)}
          onToggleTest={(testId) => toggleTest(activeId, testId)}
          onDecision={(decision, notes) =>
            saveDecision(activeId, decision, notes)
          }
          onEvidenceChange={() => invalidate(activeId)}
        />
      ) : (
        <main className={styles.waiting}>
          <p>
            {status === "loading"
              ? "Loading patients…"
              : status === "error"
                ? "Patients couldn’t be loaded."
                : "No patients to review."}
          </p>
        </main>
      )}
    </div>
  );
}
