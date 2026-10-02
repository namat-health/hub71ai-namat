"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "./SubmissionCard.module.css";

const labels = {
  age: "Age",
  sex: "Sex",
  location: "Location",
  goals: "Goals",
  symptoms: "Symptoms",
  family: "Family history",
  bloodwork: "Recent bloodwork",
  history: "Health history",
  medicines: "Medicines",
  prevention: "Prevention interests",
  motivation: "What matters most",
  checkup: "Checkup interests",
  performance: "Performance interests",
  priority: "Top priority",
  curiosity: "Curious about",
  sleep: "Sleep",
  weight: "Weight change",
  height_cm: "Height (cm)",
  weight_kg: "Weight (kg)",
  alcohol: "Alcohol",
  tobacco: "Tobacco",
  hormones: "Hormones",
  pregnancy: "Pregnancy",
  treatment: "Treatment",
  country: "Country",
};

const terms = {
  "abu-dhabi": "Abu Dhabi",
  uae_move: "UAE move",
  yes: "Yes",
  no: "No",
  never: "Never",
};

function pretty(value) {
  if (Array.isArray(value)) return value.map(pretty).filter(Boolean).join(", ");
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object")
    return Object.entries(value)
      .map(([key, item]) => `${labels[key] || key}: ${pretty(item)}`)
      .join(" · ");

  const text = String(value);
  return (
    terms[text] ||
    text
      .replaceAll("_", " ")
      .replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
  );
}

function entries(value) {
  return Object.entries(value || {}).filter(([, item]) => pretty(item));
}

export default function SubmissionCard({ submission }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [firstName, setFirstName] = useState(submission.firstName || "");
  const [answersDraft, setAnswersDraft] = useState({});
  const [notesDraft, setNotesDraft] = useState({});
  const answers = entries(submission.answers);
  const notes = entries(submission.notes);
  const date = new Date(submission.createdAt).toISOString().slice(0, 10);

  function beginEdit() {
    setFirstName(submission.firstName || "");
    setAnswersDraft(
      Object.fromEntries(
        Object.entries(submission.answers || {}).map(([key, value]) => [
          key,
          Array.isArray(value) ? value.join(", ") : String(value ?? ""),
        ]),
      ),
    );
    setNotesDraft(
      Object.fromEntries(
        Object.entries(submission.notes || {}).map(([key, value]) => [
          key,
          String(value ?? ""),
        ]),
      ),
    );
    setMessage("");
    setError("");
    setEditing(true);
  }

  async function saveChanges(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");

    const answers = Object.fromEntries(
      Object.entries(answersDraft).map(([key, value]) => [
        key,
        Array.isArray(submission.answers[key])
          ? value
              .split(",")
              .map((item) => item.trim())
              .filter(Boolean)
          : value,
      ]),
    );

    try {
      const response = await fetch(`/api/submissions/${submission.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName, answers, notes: notesDraft }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Could not save your changes.");
      setEditing(false);
      setMessage("Changes saved.");
      router.refresh();
    } catch (saveError) {
      setError(saveError.message || "Could not save your changes.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className={styles.card}>
      <header className={styles.header}>
        <div>
          {editing ? (
            <label className={styles.nameField}>
              Name
              <input
                value={firstName}
                maxLength={120}
                onChange={(event) => setFirstName(event.target.value)}
              />
            </label>
          ) : (
            <h2>{submission.firstName || "Welcome"}</h2>
          )}
          <p className={styles.email}>{submission.email}</p>
        </div>
        {!editing && (
          <button
            className={styles.editToggle}
            type="button"
            onClick={beginEdit}
          >
            Edit
          </button>
        )}
      </header>

      <section className={styles.section}>
        <h3>About you</h3>
        {editing ? (
          <>
            <p className={styles.editHint}>
              Separate multiple answers with commas.
            </p>
            <div className={styles.editGrid}>
              {Object.entries(answersDraft).map(([key, value]) => (
                <label className={styles.editField} key={key}>
                  <span>{labels[key] || pretty(key)}</span>
                  <input
                    value={value}
                    maxLength={1000}
                    onChange={(event) =>
                      setAnswersDraft((current) => ({
                        ...current,
                        [key]: event.target.value,
                      }))
                    }
                  />
                </label>
              ))}
            </div>
          </>
        ) : answers.length ? (
          <dl className={styles.answers}>
            {answers.map(([key, value]) => (
              <div className={styles.answer} key={key}>
                <dt>{labels[key] || pretty(key)}</dt>
                <dd>{pretty(value)}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className={styles.empty}>No answers saved.</p>
        )}
      </section>

      {(notes.length > 0 ||
        (editing && Object.keys(notesDraft).length > 0)) && (
        <section className={styles.section}>
          <h3>Notes</h3>
          {editing ? (
            <div className={styles.editGrid}>
              {Object.entries(notesDraft).map(([key, value]) => (
                <label className={styles.editField} key={key}>
                  <span>{labels[key] || pretty(key)}</span>
                  <input
                    value={value}
                    maxLength={1000}
                    onChange={(event) =>
                      setNotesDraft((current) => ({
                        ...current,
                        [key]: event.target.value,
                      }))
                    }
                  />
                </label>
              ))}
            </div>
          ) : (
            <dl className={styles.notes}>
              {notes.map(([key, value]) => (
                <div key={key}>
                  <dt>{labels[key] || pretty(key)}</dt>
                  <dd>{pretty(value)}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>
      )}

      {submission.reports.length > 0 && (
        <section className={styles.section}>
          <h3>Attached reports</h3>
          <ul className={styles.reports}>
            {submission.reports.map((report, index) => (
              <li key={`${report.name}-${index}`}>
                <span aria-hidden="true">▧</span>
                <span>
                  <strong>{report.name}</strong>
                  <small>
                    {report.type} ·{" "}
                    {Math.max(1, Math.round(report.size / 1024))} KB
                  </small>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {editing && (
        <form className={styles.actions} onSubmit={saveChanges}>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <button
            className={styles.cancel}
            type="button"
            disabled={saving}
            onClick={() => setEditing(false)}
          >
            Cancel
          </button>
          <button className={styles.save} type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </button>
        </form>
      )}

      {message && (
        <p className={styles.message} role="status">
          {message}
        </p>
      )}

      <footer className={styles.footer}>
        <span>Questionnaire {submission.questionnaireVersion}</span>
        <time dateTime={submission.createdAt}>{date}</time>
      </footer>
    </article>
  );
}
