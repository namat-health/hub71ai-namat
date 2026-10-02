import { useEffect, useRef } from "react";
import styles from "./Overlays.module.css";
import { useSheetFocus } from "./PlanModal";
import shared from "./shared.module.css";

export default function QuestionnaireDrawer({
  open,
  focusKey,
  focusAt,
  name,
  groups,
  onClose,
}) {
  const closeRef = useRef(null);
  const bodyRef = useRef(null);
  useSheetFocus(open, closeRef);

  // Opened from evidence: bring that answer into view once the sheet moves.
  useEffect(() => {
    void focusAt;
    const body = bodyRef.current;
    if (!open || !body) return;
    if (!focusKey) {
      body.scrollTo({ top: 0 });
      return;
    }
    const timer = setTimeout(() => {
      const row = body.querySelector(`[data-key="${focusKey}"]`);
      if (!row) return;
      const top =
        row.getBoundingClientRect().top -
        body.getBoundingClientRect().top +
        body.scrollTop -
        60;
      body.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    }, 120);
    return () => clearTimeout(timer);
  }, [open, focusKey, focusAt]);

  return (
    <>
      <div
        className={`${styles.drawerScrim} ${open ? styles.open : ""}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className={`${styles.drawer} ${open ? styles.drawerOpen : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="questionnaire-title"
        inert={!open}
      >
        <header className={styles.drawerHeader}>
          <div className={styles.titleBlock}>
            <span className={shared.eyebrow}>Questionnaire</span>
            <h2 id="questionnaire-title" className={styles.drawerTitle}>
              {name}
            </h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            className={`${styles.close} ${styles.drawerClose}`}
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div ref={bodyRef} className={styles.drawerBody}>
          {groups.map((group) => (
            <div key={group.group} className={styles.intakeGroup}>
              <span className={`${shared.eyebrow} ${styles.intakeGroupName}`}>
                {group.group}
              </span>
              {group.rows.map((row) => (
                <div
                  key={row.key}
                  data-key={row.key}
                  className={`${styles.intakeRow} ${open && focusKey === row.key ? styles.intakeRowFocus : ""}`}
                >
                  <span className={styles.intakeLabel}>{row.label}</span>
                  <span
                    className={`${styles.intakeText} ${row.text ? "" : styles.intakeEmpty}`}
                  >
                    {row.text || "—"}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </aside>
    </>
  );
}
