import { useEffect, useRef, useState } from "react";
import { displayUnit, labSection, rangePosition } from "@/lib/lab-values.mjs";
import styles from "./ParsedValues.module.css";
import shared from "./shared.module.css";

const FLAG = { low: "Low", high: "High" };
const FLAG_TITLE = {
  low: "Below the range printed on the report",
  high: "Above the range printed on the report",
};
const SAVE_ERROR = "The value couldn’t be saved. Please try again.";
const FOCUS_MS = 2400;

// Groups follow the report: "Blood count · page 1", "Chemistry · page 2".
function groupLabs(labs, pageNumber) {
  const groups = new Map();
  for (const lab of labs) {
    const page = pageNumber(lab);
    const section = labSection(lab);
    const key = `${page}:${section}`;
    if (!groups.has(key))
      groups.set(key, {
        key,
        page,
        order: section === "Blood count" ? 0 : 1,
        name: `${section} · page ${page}`,
        labs: [],
      });
    groups.get(key).labs.push(lab);
  }
  return [...groups.values()].sort(
    (a, b) => a.page - b.page || a.order - b.order,
  );
}

function reportStatus(report, extraction, many) {
  const name = many ? `${report.name}: ` : "";
  if (!extraction) return `${name}Loading what Namat read…`;
  if (extraction.state === "unsupported")
    return `${name}This older upload wasn’t read by Namat. Check the original.`;
  if (extraction.state === "error")
    return `${name}What Namat read couldn’t be loaded. Try again shortly.`;
  const { data } = extraction;
  if (data.extraction)
    return data.extraction.labs.length
      ? null
      : `${name}Namat found no lab values it recognises. Check the original.`;
  if (data.status === "failed")
    return `${name}Namat couldn’t read this report. Check the original.`;
  return `${name}Namat is still reading this report.`;
}

function RangeBar({ lab }) {
  const position = rangePosition(lab);
  return (
    <span className={styles.bar} aria-hidden="true">
      <span className={styles.track} />
      {position !== null && (
        <>
          <span className={styles.band} />
          <span
            className={`${styles.dot} ${lab.flag ? styles.dotOut : ""}`}
            style={{ left: `${position}%` }}
          />
        </>
      )}
    </span>
  );
}

// A flagged value waits for the doctor: "Looks right" keeps the reading,
// "Fix" replaces it. Either way it is saved as checked.
function LabRow({ lab, focused, onLocate, onConfirm, onFix }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState({
    value: "",
    unit: "",
    referenceRange: "",
  });
  const firstField = useRef(null);
  const needsCheck = Boolean(lab.note);

  useEffect(() => {
    if (editing) firstField.current?.focus();
  }, [editing]);

  const run = async (save) => {
    setSaving(true);
    setError("");
    try {
      await save();
      setEditing(false);
    } catch (issue) {
      setError(issue?.message || SAVE_ERROR);
    } finally {
      setSaving(false);
    }
  };
  const edit = (field) => (event) =>
    setDraft((current) => ({ ...current, [field]: event.target.value }));

  return (
    <div
      className={`${styles.entry} ${needsCheck ? styles.entryCheck : ""} ${focused ? styles.entryFocus : ""}`}
      data-lab={lab.id}
    >
      <button
        type="button"
        className={`${styles.row} ${needsCheck ? styles.rowWithCheck : ""}`}
        title="Show in report"
        onClick={() => onLocate(lab)}
      >
        <span className={styles.name}>{lab.name}</span>
        <span className={styles.value}>
          <span className={styles.number}>{lab.display}</span>
          {lab.unit && (
            <>
              {" "}
              <span className={styles.unit}>{displayUnit(lab.unit)}</span>
            </>
          )}
          {lab.confirmed && (
            <span className={styles.checked} title="Checked by a doctor">
              ✓
            </span>
          )}
        </span>
        <RangeBar lab={lab} />
        <span className={styles.flag} title={FLAG_TITLE[lab.flag]}>
          {FLAG[lab.flag] || ""}
        </span>
      </button>
      {needsCheck && !editing && (
        <div className={styles.check}>
          <span className={styles.note}>{lab.note}</span>
          <span className={styles.actions}>
            <button
              type="button"
              className={styles.looksRight}
              disabled={saving}
              onClick={() => run(() => onConfirm(lab))}
            >
              {saving ? "Saving…" : "Looks right"}
            </button>
            <button
              type="button"
              className={styles.fix}
              disabled={saving}
              onClick={() => {
                setDraft({
                  value: lab.display === "—" ? "" : lab.display,
                  unit: lab.unit || "",
                  referenceRange: lab.refText || "",
                });
                setError("");
                setEditing(true);
              }}
            >
              Fix
            </button>
          </span>
        </div>
      )}
      {needsCheck && editing && (
        <form
          className={styles.fixForm}
          aria-label={`Fix ${lab.name}`}
          onSubmit={(event) => {
            event.preventDefault();
            run(() => onFix(lab, draft));
          }}
        >
          <label className={styles.field}>
            <span>Value</span>
            <input
              ref={firstField}
              value={draft.value}
              onChange={edit("value")}
              maxLength={40}
              required
            />
          </label>
          <label className={styles.field}>
            <span>Unit</span>
            <input value={draft.unit} onChange={edit("unit")} maxLength={30} />
          </label>
          <label className={`${styles.field} ${styles.fieldWide}`}>
            <span>Range</span>
            <input
              value={draft.referenceRange}
              onChange={edit("referenceRange")}
              maxLength={60}
            />
          </label>
          <span className={styles.actions}>
            <button
              type="submit"
              className={styles.looksRight}
              disabled={saving}
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              className={styles.fix}
              disabled={saving}
              onClick={() => {
                setEditing(false);
                setError("");
              }}
            >
              Cancel
            </button>
          </span>
        </form>
      )}
      {error && (
        <p className={styles.saveError} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export default function ParsedValues({
  reports,
  extractions,
  labs,
  pageNumber,
  onLocate,
  onSaveValue,
  rowFocus,
}) {
  const listRef = useRef(null);
  const [focusedId, setFocusedId] = useState(null);

  // Taken here from the plan card: bring the value into view and mark it.
  useEffect(() => {
    if (!rowFocus) return;
    setFocusedId(rowFocus.id);
    listRef.current
      ?.querySelector(`[data-lab="${CSS.escape(rowFocus.id)}"]`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
    const timer = setTimeout(() => setFocusedId(null), FOCUS_MS);
    return () => clearTimeout(timer);
  }, [rowFocus]);

  if (!reports.length)
    return (
      <div className={styles.list}>
        <p className={styles.message}>No lab report was uploaded.</p>
      </div>
    );
  const messages = reports
    .map((report) => ({
      id: report.id,
      text: reportStatus(report, extractions[report.id], reports.length > 1),
    }))
    .filter((message) => message.text);

  return (
    <div ref={listRef} className={styles.list}>
      {messages.map((message) => (
        <p key={message.id} className={styles.message}>
          {message.text}
        </p>
      ))}
      {groupLabs(labs, pageNumber).map((group) => (
        <div key={group.key} className={styles.group}>
          <span className={`${shared.eyebrow} ${styles.groupName}`}>
            {group.name}
          </span>
          {group.labs.map((lab) => (
            <LabRow
              key={lab.id}
              lab={lab}
              focused={focusedId === lab.id}
              onLocate={onLocate}
              onConfirm={(value) => onSaveValue(value, "confirm")}
              onFix={(value, edits) => onSaveValue(value, "correct", edits)}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
