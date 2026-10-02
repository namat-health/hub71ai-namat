import Image from "next/image";
import ClinicalEvidence, {
  FindingBasis,
  ReviewAlerts,
} from "./ClinicalEvidence";
import evidenceStyles from "./ClinicalEvidence.module.css";
import styles from "./PlanCard.module.css";
import shared from "./shared.module.css";

function BloodDrop({ size }) {
  return (
    <Image
      src="/blood-drop.webp"
      alt=""
      width={size}
      height={size}
      unoptimized
      priority
      className={styles.drop}
    />
  );
}

function Finding({
  finding,
  index,
  open,
  onToggle,
  chips,
  analysis,
  onEvidence,
}) {
  const act = finding.severity === "act";
  return (
    <div className={styles.finding}>
      <button
        type="button"
        className={styles.findingButton}
        aria-expanded={open}
        aria-controls={`finding-${index}`}
        onClick={onToggle}
      >
        <span
          className={`${styles.severity} ${act ? styles.severityAct : ""}`}
          title={act ? "Review priority" : "Review in context"}
        />
        <span className={styles.findingTitle}>{finding.title}</span>
        <span className={styles.findingValues}>{finding.keyValues}</span>
        <span
          className={`${styles.chevron} ${open ? styles.chevronOpen : ""}`}
          aria-hidden="true"
        >
          ⌄
        </span>
      </button>
      {open && (
        <div className={styles.findingBody} id={`finding-${index}`}>
          <p className={styles.reason}>{finding.reasonShort}</p>
          {chips.length > 0 && (
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
          )}
          <FindingBasis
            analysis={analysis}
            index={index}
            onEvidence={onEvidence}
          />
        </div>
      )}
    </div>
  );
}

export default function PlanCard({
  state,
  expanded,
  onToggleFinding,
  chipsFor,
  toConfirm,
  onConfirmFirst,
  onCreate,
  onToggleTest,
  onReadPlan,
  onApprove,
  onEvidence,
}) {
  if (["loading", "loading_saved"].includes(state.status)) {
    return (
      <section className={styles.card} aria-label="Plan" aria-busy="true">
        <div className={styles.loading}>
          <span className={styles.spinner} aria-hidden="true" />
          <div className={styles.progressBlock}>
            <output className={styles.step}>
              {state.status === "loading_saved"
                ? "Loading the saved assessment…"
                : "Analyzing clinical results…"}
            </output>
            {state.status === "loading" && (
              <p className={styles.loadingHint}>
                Reviewing the reports and questionnaire. This may take a few
                minutes.
              </p>
            )}
          </div>
        </div>
      </section>
    );
  }

  // No plan is built on a flagged value nobody has checked.
  const waiting = toConfirm.length;
  if (state.status !== "ready") {
    return (
      <section className={styles.card} aria-label="Plan">
        <div className={styles.empty}>
          <BloodDrop size={220} />
          <button
            type="button"
            className={shared.primary}
            onClick={waiting ? onConfirmFirst : onCreate}
          >
            {waiting === 0
              ? "Create clinical assessment"
              : waiting === 1
                ? `Confirm ${toConfirm[0].short} first`
                : `Confirm ${waiting} values first`}
            <span className={shared.primaryArrow} aria-hidden="true">
              →
            </span>
          </button>
          {state.error && (
            <p className={styles.error} role="alert">
              {state.error}
            </p>
          )}
          {state.notice && (
            <p className={evidenceStyles.notice}>{state.notice}</p>
          )}
        </div>
      </section>
    );
  }

  const { plan, selected = [], analysis } = state;
  const decision = analysis?.latestDecision;
  return (
    <section className={styles.card} aria-label="Plan">
      <div className={styles.ready}>
        <div className={styles.head}>
          <div className={styles.headRow}>
            <span className={shared.eyebrow}>
              {analysis?.demo
                ? "Demo assessment · AI draft"
                : "Clinical assessment · Draft"}
            </span>
            <button
              type="button"
              className={styles.regenerate}
              title={
                waiting ? "Confirm the flagged values first" : "Regenerate"
              }
              aria-label="Regenerate"
              disabled={!onCreate || waiting > 0 || state.decisionSaving}
              onClick={onCreate}
            >
              ↻
            </button>
          </div>
          <p className={styles.summary}>{plan.summaryShort}</p>
          <p className={evidenceStyles.notice}>
            {analysis?.preview
              ? "Illustrative fictional preview · no live model call"
              : analysis?.demo
                ? "Single-pass demo interpretation · requires clinician review"
                : "AI draft for clinician review · demonstration rules are not clinically validated"}
          </p>
          <ReviewAlerts analysis={analysis} />
        </div>

        {plan.findings.length > 0 && (
          <div className={styles.findings}>
            <span className={`${shared.eyebrow} ${styles.findingsLabel}`}>
              Findings
            </span>
            {plan.findings.slice(0, 3).map((finding, index) => (
              <Finding
                // Findings have no IDs; their order is fixed per plan.
                // biome-ignore lint/suspicious/noArrayIndexKey: stable order within one plan.
                key={index}
                finding={finding}
                index={index}
                open={expanded.has(index)}
                onToggle={() => onToggleFinding(index)}
                chips={chipsFor(finding)}
                analysis={analysis}
                onEvidence={onEvidence}
              />
            ))}
            {plan.findings.length > 3 && (
              <button
                type="button"
                className={shared.textButton}
                onClick={onReadPlan}
              >
                View all {plan.findings.length} findings ↗
              </button>
            )}
          </div>
        )}

        {plan.tests.length > 0 && (
          <div className={styles.tests}>
            <span className={shared.eyebrow}>
              Tests for your consideration · select individually
            </span>
            <div className={styles.testPills}>
              {plan.tests.map((test) => {
                const on = selected.includes(test.id);
                return (
                  <button
                    type="button"
                    key={test.id}
                    className={`${styles.testPill} ${on ? styles.testPillOn : ""}`}
                    title={test.reason}
                    aria-pressed={on}
                    disabled={state.decisionSaving}
                    onClick={() => onToggleTest(test.id)}
                  >
                    <span className={styles.testMark} aria-hidden="true">
                      {on ? "✓" : "+"}
                    </span>
                    {test.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <ClinicalEvidence analysis={analysis} compact onEvidence={onEvidence} />
      </div>

      <footer className={styles.footer}>
        {decision && (
          <span className={evidenceStyles.notice}>
            {state.selectionChanged
              ? "Selection changed since saved review"
              : `Review saved: ${decision.decision.replaceAll("_", " ")}`}
          </span>
        )}
        <button
          type="button"
          className={shared.textButton}
          onClick={onReadPlan}
        >
          Read assessment <span aria-hidden="true">↗</span>
        </button>
        <button
          type="button"
          className={shared.primarySmall}
          onClick={onApprove}
        >
          Record review
          <span className={shared.primarySmallArrow} aria-hidden="true">
            →
          </span>
        </button>
      </footer>
    </section>
  );
}
