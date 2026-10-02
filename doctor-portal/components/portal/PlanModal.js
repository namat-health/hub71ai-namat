import { useEffect, useRef, useState } from "react";
import { PREVIEW_LOCATIONS } from "@/lib/plan.mjs";
import Logo from "./Logo";
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

function FullPlan({ plan, selected, onToggleTest, chipsFor }) {
  return (
    <div className={styles.planBody}>
      <p className={styles.planSummary}>{plan.summaryLong}</p>

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
            After the tests
          </span>
          {plan.followUps.map((item) => (
            <div key={`${item.what}:${item.when}`} className={styles.followUp}>
              <span className={styles.followWhat}>{item.what}</span>
              <span className={styles.followWhen}>{item.when}</span>
            </div>
          ))}
        </div>
      )}

      <span className={styles.disclaimer}>
        AI-drafted from Namat’s longevity knowledge base. Reviewed and approved
        by you.
      </span>
    </div>
  );
}

function EmailPreview({ tests, firstName, email, sender }) {
  const places = Object.keys(PREVIEW_LOCATIONS)
    .filter((type) => tests.some((test) => test.locationType === type))
    .map((type) => ({ type, ...PREVIEW_LOCATIONS[type] }));
  const fasting = tests.some((test) => /fast/i.test(test.prep));
  return (
    <div className={styles.emailBody}>
      <div className={styles.envelope}>
        <span className={styles.envelopeLabel}>From</span>
        <span>{sender ? `${sender}, Namat` : "Namat"}</span>
        <span className={styles.envelopeLabel}>To</span>
        <span>{email}</span>
        <span className={styles.envelopeLabel}>Subject</span>
        <span className={styles.subject}>
          Your next tests, from {sender || "Namat"}
        </span>
      </div>
      <article className={styles.email}>
        <Logo size={26} color="#143f3c" />
        <div className={styles.emailIntro}>
          <h3 className={styles.emailHeading}>
            Hi {firstName}, here’s your plan.
          </h3>
          <p className={styles.emailText}>
            {tests.length
              ? "I’ve reviewed your questionnaire and blood results. These are the tests I’d like you to take next."
              : "I’ve reviewed your questionnaire and blood results. You don’t need any new tests right now."}
          </p>
        </div>
        {tests.length > 0 && (
          <div className={styles.emailTests}>
            {tests.map((test) => (
              <div key={test.id} className={styles.emailTest}>
                <span className={styles.emailTestName}>{test.name}</span>
                <span className={styles.emailTestWhere}>
                  {PREVIEW_LOCATIONS[test.locationType].name}
                </span>
              </div>
            ))}
          </div>
        )}
        {places.length > 0 && (
          <div className={styles.places}>
            <span className={shared.eyebrow}>Where to go</span>
            <div className={styles.placeGrid}>
              {places.map((place) => (
                <div key={place.type} className={styles.place}>
                  <div className={styles.placeText}>
                    <span className={styles.placeName}>{place.name}</span>
                    <span className={styles.placeLine}>{place.address}</span>
                    <span className={styles.placeLine}>{place.hours}</span>
                  </div>
                  <span className={styles.book}>
                    Book
                    <span className={styles.bookArrow} aria-hidden="true">
                      →
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        <p className={styles.prep}>
          {tests.length
            ? fasting
              ? "Please fast for 10 hours before your blood draw. Water is fine. "
              : "No special preparation is needed. "
            : ""}
          Once your results are in, we’ll book a call to go through them
          together.
        </p>
        {sender && <span className={styles.signoff}>{sender}</span>}
      </article>
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
  firstName,
  email,
  clinician,
  sentAt,
  onSend,
  onMode,
}) {
  const open = Boolean(mode && plan);
  // Keep showing the last step while the sheet fades out.
  const [view, setView] = useState(mode);
  if (mode && mode !== view) setView(mode);
  const closeRef = useRef(null);
  const bodyRef = useRef(null);
  useSheetFocus(open, closeRef);

  useEffect(() => {
    if (mode) bodyRef.current?.scrollTo({ top: 0 });
  }, [mode]);

  const chosen = plan
    ? plan.tests.filter((test) => selected.includes(test.id))
    : [];

  return (
    <>
      <div
        className={`${styles.modalScrim} ${open ? styles.open : ""}`}
        onClick={() => onMode(null)}
        aria-hidden="true"
      />
      <section
        className={`${styles.modal} ${open ? styles.modalOpen : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="plan-modal-title"
        inert={!open}
      >
        <header className={styles.modalHeader}>
          <div className={styles.titleBlock}>
            <span className={shared.eyebrow}>
              {view === "email" ? "Email preview" : "Personalised plan · Draft"}
            </span>
            <h2 id="plan-modal-title" className={styles.modalTitle}>
              {view === "email"
                ? `What ${firstName} will receive`
                : patientName}
            </h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            className={styles.close}
            aria-label="Close"
            onClick={() => onMode(null)}
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
            />
          )}
          {plan && view === "email" && (
            <EmailPreview
              tests={chosen}
              firstName={firstName}
              email={email}
              sender={clinician}
            />
          )}
        </div>

        <footer className={styles.modalFooter}>
          {view === "email" ? (
            <>
              <button
                type="button"
                className={shared.textButton}
                onClick={() => onMode("plan")}
              >
                ← Edit plan
              </button>
              {sentAt ? (
                <span className={styles.footerSent}>
                  <span className={shared.tick} aria-hidden="true">
                    ✓
                  </span>
                  Sent
                </span>
              ) : (
                <button
                  type="button"
                  className={shared.primarySmall}
                  title="Preview only: emails are not sent yet"
                  onClick={onSend}
                >
                  Send to {firstName}
                  <span className={shared.primarySmallArrow} aria-hidden="true">
                    →
                  </span>
                </button>
              )}
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
                onClick={() => onMode("email")}
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
    </>
  );
}
