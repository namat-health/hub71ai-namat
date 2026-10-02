import Image from "next/image";
import styles from "./PlanCard.module.css";
import shared from "./shared.module.css";

function steps(labCount) {
  return [
    "Reading the questionnaire",
    labCount
      ? `Checking ${labCount} lab ${labCount === 1 ? "value" : "values"}`
      : "Checking lab values",
    "Consulting the knowledge base",
    "Drafting the plan",
  ];
}

function BloodDrop({ size, breathing = false }) {
  return (
    <Image
      src="/blood-drop.webp"
      alt=""
      width={size}
      height={size}
      unoptimized
      priority
      className={`${styles.drop} ${breathing ? styles.breathing : ""}`}
    />
  );
}

function Finding({ finding, index, open, onToggle, chips }) {
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
          title={act ? "Act now" : "Monitor"}
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
        </div>
      )}
    </div>
  );
}

export default function PlanCard({
  state,
  labCount,
  expanded,
  onToggleFinding,
  chipsFor,
  toConfirm,
  onConfirmFirst,
  onCreate,
  onToggleTest,
  onReadPlan,
  onApprove,
  sentAt,
  firstName,
  onUndo,
}) {
  if (state.status === "loading") {
    const labels = steps(labCount);
    return (
      <section className={styles.card} aria-label="Plan" aria-busy="true">
        <div className={styles.loading}>
          <BloodDrop size={200} breathing />
          <div className={styles.progressBlock}>
            <output className={styles.step}>
              {labels[Math.min(state.step, labels.length - 1)]}
            </output>
            <span className={styles.progress} aria-hidden="true">
              <span
                className={styles.progressFill}
                style={{
                  width: `${Math.min(100, ((state.step + 0.35) / 4) * 100)}%`,
                }}
              />
            </span>
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
              ? "Create personalised plan"
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
        </div>
      </section>
    );
  }

  const { plan, selected } = state;
  return (
    <section className={styles.card} aria-label="Plan">
      <div className={styles.ready}>
        <div className={styles.head}>
          <div className={styles.headRow}>
            <span className={shared.eyebrow}>Plan · Draft</span>
            <button
              type="button"
              className={styles.regenerate}
              title={
                waiting ? "Confirm the flagged values first" : "Regenerate"
              }
              aria-label="Regenerate"
              disabled={waiting > 0}
              onClick={onCreate}
            >
              ↻
            </button>
          </div>
          <p className={styles.summary}>{plan.summaryShort}</p>
        </div>

        {plan.findings.length > 0 && (
          <div className={styles.findings}>
            <span className={`${shared.eyebrow} ${styles.findingsLabel}`}>
              Findings
            </span>
            {plan.findings.map((finding, index) => (
              <Finding
                // Findings have no IDs; their order is fixed per plan.
                // biome-ignore lint/suspicious/noArrayIndexKey: stable order within one plan.
                key={index}
                finding={finding}
                index={index}
                open={expanded.has(index)}
                onToggle={() => onToggleFinding(index)}
                chips={chipsFor(finding)}
              />
            ))}
          </div>
        )}

        {plan.tests.length > 0 && (
          <div className={styles.tests}>
            <span className={shared.eyebrow}>Tests to order</span>
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
      </div>

      <footer className={styles.footer}>
        {sentAt ? (
          <>
            <span className={styles.sent}>
              <span className={shared.tick} aria-hidden="true">
                ✓
              </span>
              Sent to {firstName}
            </span>
            <span className={styles.sentActions}>
              <button
                type="button"
                className={styles.ghost}
                onClick={onApprove}
              >
                View email
              </button>
              <button type="button" className={styles.outline} onClick={onUndo}>
                Undo
              </button>
            </span>
          </>
        ) : (
          <>
            <button
              type="button"
              className={shared.textButton}
              onClick={onReadPlan}
            >
              Read full plan <span aria-hidden="true">↗</span>
            </button>
            <button
              type="button"
              className={shared.primarySmall}
              onClick={onApprove}
            >
              Approve plan
              <span className={shared.primarySmallArrow} aria-hidden="true">
                →
              </span>
            </button>
          </>
        )}
      </footer>
    </section>
  );
}
