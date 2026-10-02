"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PatientReview from "./PatientReview";
import Rail, { MobileBar } from "./Rail";
import styles from "./Workspace.module.css";

const STEP_MS = 800;
const PLAN_ERROR = "The plan couldn’t be created. Please try again.";

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
  // Approval and sending are not stored yet, so both reset on reload.
  const [sent, setSent] = useState({});
  const [plans, setPlans] = useState({});
  const runs = useRef({});

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
      for (const run of Object.values(active)) clearInterval(run.timer);
    };
  }, []);

  const patients = useMemo(
    () => groupPatients(submissions || []),
    [submissions],
  );
  const queue = patients.filter((patient) => !sent[patient.submission.id]);
  const reviewed = patients.filter((patient) => sent[patient.submission.id]);
  const active =
    patients.find((patient) => patient.key === selectedKey) ||
    queue[0] ||
    patients[0] ||
    null;
  const activeId = active?.submission.id;

  // Pin the first patient shown, so sending a plan (which moves the patient
  // out of the queue) never switches to someone else.
  useEffect(() => {
    if (selectedKey === null && active) setSelectedKey(active.key);
  }, [selectedKey, active]);

  // Keep the open patient visible after it moves between groups.
  useEffect(() => {
    if (!activeId) return;
    const group = sent[activeId] ? "all" : "queue";
    setNavOpen((open) => (open[group] ? open : { ...open, [group]: true }));
  }, [activeId, sent]);

  const setPlan = useCallback((submissionId, value) => {
    setPlans((current) => ({ ...current, [submissionId]: value }));
  }, []);

  // Steps advance on a timer; the plan appears once the response is in and
  // the last step has shown. Errors return to the empty state straight away.
  const createPlan = useCallback(
    (submissionId) => {
      clearInterval(runs.current[submissionId]?.timer);
      const run = { step: 0, result: null, done: false };
      runs.current[submissionId] = run;
      setPlan(submissionId, { status: "loading", step: 0 });
      const current = () => runs.current[submissionId] === run && !run.done;
      const finish = () => {
        if (!current() || !run.result) return;
        if (run.result.error) {
          run.done = true;
          clearInterval(run.timer);
          setPlan(submissionId, { status: "empty", error: run.result.error });
          return;
        }
        if (run.step < 3) return;
        run.done = true;
        clearInterval(run.timer);
        setPlan(submissionId, { status: "loading", step: 4 });
        setTimeout(() => {
          if (runs.current[submissionId] !== run) return;
          const { plan, source } = run.result;
          setPlan(submissionId, {
            status: "ready",
            plan,
            source,
            selected: plan.tests
              .filter((test) => test.group === "now")
              .map((test) => test.id),
          });
        }, 500);
      };
      run.timer = setInterval(() => {
        if (!current()) return;
        run.step = Math.min(run.step + 1, 3);
        setPlan(submissionId, { status: "loading", step: run.step });
        finish();
      }, STEP_MS);
      fetch(`/api/submissions/${encodeURIComponent(submissionId)}/plan`, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json" },
      })
        .then(async (response) => {
          const data = await response.json().catch(() => ({}));
          run.result =
            response.ok && Array.isArray(data.plan?.tests)
              ? data
              : {
                  error:
                    typeof data.error === "string" ? data.error : PLAN_ERROR,
                };
        })
        .catch(() => {
          run.result = { error: PLAN_ERROR };
        })
        .finally(finish);
    },
    [setPlan],
  );

  const toggleTest = useCallback((submissionId, testId) => {
    setPlans((current) => {
      const plan = current[submissionId];
      if (plan?.status !== "ready") return current;
      const selected = plan.selected.includes(testId)
        ? plan.selected.filter((id) => id !== testId)
        : [...plan.selected, testId];
      return { ...current, [submissionId]: { ...plan, selected } };
    });
  }, []);

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
          sentAt={sent[activeId] || null}
          onSend={() =>
            setSent((current) => ({
              ...current,
              [activeId]: new Date().toISOString(),
            }))
          }
          onUndo={() =>
            setSent((current) => {
              const next = { ...current };
              delete next[activeId];
              return next;
            })
          }
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
