import { useEffect, useRef, useState } from "react";
import ClinicalEvidence, {
  FindingBasis,
  ReviewAlerts,
} from "./ClinicalEvidence";
import evidenceStyles from "./ClinicalEvidence.module.css";
import styles from "./Overlays.module.css";
import shared from "./shared.module.css";

// Keeps keyboard focus inside an open sheet and returns it on close.
export function useSheetFocus(open, closeRef) {
  const returnTo = useRef(null);
  useEffect(() => {
    if (open) {
      returnTo.current = document.activeElement;
      closeRef.current?.focus({ preventScroll: true });
      return;
    }
    if (returnTo.current?.isConnected) returnTo.current.focus();
    returnTo.current = null;
  }, [open, closeRef]);
}

function Chips({ chips }) {
  if (!chips.length) return null;
  return (
    <div className={styles.chips}>
      {chips.map((chip) => (
        <button
          type="button"
          key={chip.key}
          className={shared.chip}
          onClick={chip.onClick}
        >
          {chip.text}
          <span className={shared.chipWhere}>{chip.where}</span>
        </button>
      ))}
    </div>
  );
}

function FullPlan({
  plan,
  selected,
  onToggleTest,
  chipsFor,
  analysis,
  onEvidence,
  saving,
}) {
  return (
    <div className={styles.planBody}>
      <p className={styles.planSummary}>{plan.summaryLong}</p>
      <ReviewAlerts analysis={analysis} />

      {plan.findings.length > 0 && (
        <div className={styles.section}>
          <span className={`${shared.eyebrow} ${styles.sectionLabel}`}>
            Findings
          </span>
          {plan.findings.map((finding, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: findings keep their order within one plan.
            <article key={index} className={styles.findingFull}>
              <span
                className={`${styles.findingNumber} ${finding.severity === "act" ? styles.findingNumberAct : ""}`}
              >
                {String(index + 1).padStart(2, "0")}
              </span>
              <div className={styles.findingContent}>
                <div className={styles.findingTop}>
                  <h3 className={styles.findingFullTitle}>{finding.title}</h3>
                  <span className={styles.findingFullValues}>
                    {finding.keyValues}
                  </span>
                </div>
                <p className={styles.findingLong}>{finding.reasonLong}</p>
                <Chips chips={chipsFor(finding, { fromModal: true })} />
                <FindingBasis
                  analysis={analysis}
                  index={index}
                  onEvidence={onEvidence}
                />
              </div>
            </article>
          ))}
        </div>
      )}

      {plan.tests.length > 0 && (
        <div className={styles.section}>
          <span className={`${shared.eyebrow} ${styles.sectionLabel}`}>
            Tests
          </span>
          {plan.tests.map((test) => {
            const on = selected.includes(test.id);
            return (
              <button
                type="button"
                key={test.id}
                className={styles.testRow}
                aria-pressed={on}
                disabled={saving}
                onClick={() => onToggleTest(test.id)}
              >
                <span
                  className={`${styles.checkbox} ${on ? styles.checkboxOn : ""}`}
                  aria-hidden="true"
                >
                  {on ? "✓" : ""}
                </span>
                <span
                  className={`${styles.testText} ${on ? styles.testTextOn : ""}`}
                >
                  <span className={styles.testName}>{test.name}</span>
                  <span className={styles.testReason}>{test.reason}</span>
                  {test.includes && (
                    <span className={styles.testIncludes}>{test.includes}</span>
                  )}
                </span>
                <span className={styles.testPrep}>{test.prep}</span>
              </button>
            );
          })}
        </div>
      )}

      {plan.followUps.length > 0 && (
        <div className={styles.section}>
          <span className={`${shared.eyebrow} ${styles.sectionLabel}`}>
            Follow-up for clinician review
          </span>
          {plan.followUps.map((item) => (
            <div key={`${item.what}:${item.when}`} className={styles.followUp}>
              <span className={styles.followWhat}>{item.what}</span>
              <span className={styles.followWhen}>{item.when}</span>
            </div>
          ))}
        </div>
      )}

      <ClinicalEvidence analysis={analysis} onEvidence={onEvidence} />
      <span className={styles.disclaimer}>
        Doctor-facing draft. Every interpretation and proposed action requires
        clinical review. Recording a decision does not place orders or send a
        patient message.
      </span>
    </div>
  );
}

export default function PlanModal({
  mode,
  plan,
  selected,
  onToggleTest,
  chipsFor,
  patientName,
  onMode,
  analysis,
  onDecision,
  saving,
  decisionError,
  onEvidence,
}) {
  const open = Boolean(mode && plan);
  const [view, setView] = useState(mode);
  if (mode && mode !== view) setView(mode);
  const [decision, setDecision] = useState("approved");
  const [notes, setNotes] = useState("");
  const [attested, setAttested] = useState(false);
  const closeRef = useRef(null),
    bodyRef = useRef(null),
    dialogRef = useRef(null);
  useSheetFocus(open, closeRef);
  useEffect(() => {
    if (mode) bodyRef.current?.scrollTo({ top: 0 });
    if (mode === "review") setAttested(false);
  }, [mode]);
  useEffect(() => {
    void analysis?.runId;
    setNotes(analysis?.latestDecision?.notes || "");
    setDecision(analysis?.latestDecision?.decision || "approved");
    setAttested(false);
  }, [analysis?.runId, analysis?.latestDecision]);
  const chosen = plan
    ? plan.tests.filter((test) => selected.includes(test.id))
    : [];
  const trapFocus = (event) => {
    if (event.key !== "Tab" || !open) return;
    const elements = [
      ...dialogRef.current.querySelectorAll(
        'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
      ),
    ].filter((element) => element.getClientRects().length);
    const first = elements[0],
      last = elements.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };
  return (
    <>
      <div
        className={`${styles.modalScrim} ${open ? styles.open : ""}`}
        onClick={() => !saving && onMode(null)}
        aria-hidden="true"
      />
      <section
        ref={dialogRef}
        className={`${styles.modal} ${open ? styles.modalOpen : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="plan-modal-title"
        inert={!open}
        onKeyDown={trapFocus}
      >
        <header className={styles.modalHeader}>
          <div className={styles.titleBlock}>
            <span className={shared.eyebrow}>
              {view === "review"
                ? "Record clinician decision"
                : "Clinical assessment · Draft"}
            </span>
            <h2 id="plan-modal-title" className={styles.modalTitle}>
              {patientName}
            </h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            className={styles.close}
            aria-label="Close"
            onClick={() => onMode(null)}
            disabled={saving}
          >
            ×
          </button>
        </header>
        <div ref={bodyRef} className={styles.modalBody}>
          {plan && view === "plan" && (
            <FullPlan
              plan={plan}
              selected={selected}
              onToggleTest={onToggleTest}
              chipsFor={chipsFor}
              analysis={analysis}
              onEvidence={onEvidence}
              saving={saving}
            />
          )}
          {plan && view === "review" && (
            <div className={evidenceStyles.reviewForm}>
              {analysis?.latestDecision && (
                <p className={evidenceStyles.saved}>
                  Last saved:{" "}
                  {analysis.latestDecision.decision.replaceAll("_", " ")}
                  {analysis.latestDecision.createdAt
                    ? ` · ${new Date(analysis.latestDecision.createdAt).toLocaleString()}`
                    : ""}
                </p>
              )}
              <h3>
                {chosen.length} {chosen.length === 1 ? "test" : "tests"}{" "}
                selected by you
              </h3>
              {chosen.length > 0 ? (
                <ul>
                  {chosen.map((test) => (
                    <li key={test.id}>{test.name}</li>
                  ))}
                </ul>
              ) : (
                <p>
                  No test is selected. This does not mean that further
                  assessment is unnecessary.
                </p>
              )}
              <ReviewAlerts analysis={analysis} />
              <label>
                Review decision
                <select
                  value={decision}
                  onChange={(event) => setDecision(event.target.value)}
                  disabled={saving}
                >
                  <option value="approved">Approve reviewed assessment</option>
                  <option value="needs_changes">
                    Needs changes or more information
                  </option>
                  <option value="rejected">Reject this assessment</option>
                </select>
              </label>
              <label>
                Clinical notes and changes
                <textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  rows={5}
                  maxLength={2000}
                  disabled={saving}
                  placeholder="Record corrections, missing actions, or why you changed a proposed test."
                />
              </label>
              {decision === "approved" && (
                <label className={evidenceStyles.attestation}>
                  <input
                    type="checkbox"
                    checked={attested}
                    onChange={(event) => setAttested(event.target.checked)}
                    disabled={saving}
                  />
                  <span>
                    I reviewed the source evidence, limitations and selected
                    actions for this version.
                  </span>
                </label>
              )}
              <p>
                Save the review in the clinical record. Patient communication
                and laboratory ordering are separate steps.
              </p>
              {!analysis?.runId && (
                <p className={evidenceStyles.notice}>
                  This preview cannot save a clinical decision.
                </p>
              )}
              {decisionError && (
                <p className={evidenceStyles.error} role="alert">
                  {decisionError}
                </p>
              )}
            </div>
          )}
        </div>
        <footer className={styles.modalFooter}>
          {view === "review" ? (
            <>
              <button
                type="button"
                className={shared.textButton}
                onClick={() => onMode("plan")}
                disabled={saving}
              >
                ← Review assessment
              </button>
              <button
                type="button"
                className={shared.primarySmall}
                disabled={
                  saving ||
                  !analysis?.runId ||
                  (decision === "approved" && !attested)
                }
                onClick={() => onDecision?.(decision, notes)}
              >
                {saving ? "Saving decision…" : "Save review decision"}
                <span className={shared.primarySmallArrow} aria-hidden="true">
                  →
                </span>
              </button>
            </>
          ) : (
            <>
              <span className={styles.selectedCount}>
                {chosen.length} {chosen.length === 1 ? "test" : "tests"}{" "}
                selected
              </span>
              <button
                type="button"
                className={shared.primarySmall}
                onClick={() => onMode("review")}
              >
                Record review
                <span className={shared.primarySmallArrow} aria-hidden="true">
                  →
                </span>
              </button>
            </>
          )}
        </footer>
      </section>
    </>
  );
}
