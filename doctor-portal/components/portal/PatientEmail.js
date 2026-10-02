import { useEffect, useId, useRef, useState } from "react";
import evidenceStyles from "./ClinicalEvidence.module.css";
import styles from "./PatientEmail.module.css";
import shared from "./shared.module.css";

const BLOCKED = {
  "participant-email-not-approved":
    "Not sent: participant emails aren't approved for the doctor portal.",
  "recipient-not-approved":
    "Not sent: owner-test mode only sends to the owner's address.",
  "api-key-required":
    "Not sent: the Brevo key isn't set for the doctor portal.",
};

function outcome(delivery, to) {
  switch (delivery?.state) {
    case "accepted":
      return { ok: true, text: `Sent to ${to}.` };
    case "simulated":
      return {
        ok: false,
        text: "Not sent: email delivery is off in this portal (local mode). The preview is exactly what the patient would receive.",
      };
    case "blocked":
      return {
        ok: false,
        text:
          BLOCKED[delivery.reason] ||
          "Not sent: email delivery isn't switched on for the doctor portal.",
      };
    case "retry":
      return { ok: false, text: "Brevo is busy. Try again in a minute." };
    case "failed":
      return { ok: false, text: "Brevo rejected the email. Nothing was sent." };
    default:
      return {
        ok: false,
        text: "The result is unknown. Check Brevo before sending again.",
      };
  }
}

// Shown once the doctor's saved review is approved: preview the patient's results email,
// add an optional note, then send it. The server rebuilds the email for every request.
export default function PatientEmail({ submissionId, runId, name }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [previewReady, setPreviewReady] = useState(false);
  const dialogRef = useRef(null);
  const titleId = useId();

  useEffect(() => {
    if (open) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [open]);

  async function request(send) {
    setBusy(send ? "send" : "preview");
    setError("");
    if (!send) {
      setPreview(null);
      setPreviewReady(false);
    }
    const note = message.trim();
    try {
      const response = await fetch(
        `/api/submissions/${submissionId}/patient-email`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ runId, message: note || undefined, send }),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(data.error || "The email could not be prepared.");
      if (send) setResult(outcome(data.delivery, data.to));
      else {
        setPreview({ ...data, note });
        setResult(null);
      }
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(null);
    }
  }

  const stale = preview && message.trim() !== preview.note;
  return (
    <>
      <section className={styles.panel} aria-label="Patient email">
        <div className={styles.row}>
          <div>
            <span className={shared.eyebrow}>Patient email</span>
            <p className={evidenceStyles.notice}>
              Send {name} the approved summary, their results, the tests you
              chose and where to have them drawn.
            </p>
          </div>
          <button
            type="button"
            className={shared.primarySmall}
            onClick={() => {
              setOpen(true);
              if (!result?.ok && busy === null) request(false);
            }}
          >
            {result?.ok ? "View email" : `Email ${name}`}
            <span className={shared.primarySmallArrow} aria-hidden="true">
              →
            </span>
          </button>
        </div>
      </section>
      <dialog
        ref={dialogRef}
        className={styles.dialog}
        aria-labelledby={titleId}
        onCancel={(event) => {
          event.preventDefault();
          if (busy !== "send") setOpen(false);
        }}
        onClose={() => setOpen(false)}
      >
        <header className={styles.header}>
          <div className={styles.heading}>
            <span className={shared.eyebrow}>Patient email</span>
            <h2 id={titleId}>Email to {name}</h2>
            {preview && (
              <p className={evidenceStyles.notice}>
                To {preview.to} · {preview.subject}
                {preview.mode === "local"
                  ? " · Preview only: sending is off in this portal"
                  : ""}
              </p>
            )}
          </div>
          <button
            type="button"
            className={shared.textButton}
            onClick={() => setOpen(false)}
            disabled={busy === "send"}
          >
            Close
          </button>
        </header>
        <div className={styles.body}>
          <label className={styles.label}>
            Note from you (optional, shown at the top)
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              rows={3}
              maxLength={1000}
              disabled={busy !== null || result?.ok}
              placeholder="A few words for the patient."
            />
          </label>
          <div className={styles.preview} aria-busy={busy === "preview"}>
            {busy === "preview" && <output>Preparing email preview…</output>}
            {preview && (
              <iframe
                className={styles.frame}
                title={`Email preview for ${name}`}
                sandbox=""
                srcDoc={preview.html}
                onLoad={() => setPreviewReady(true)}
              />
            )}
          </div>
        </div>
        <footer className={styles.footer}>
          {stale && (
            <output className={evidenceStyles.notice}>
              Update the preview to send this note.
            </output>
          )}
          {result && (
            <output
              className={
                result.ok ? evidenceStyles.saved : evidenceStyles.error
              }
            >
              {result.text}
            </output>
          )}
          {error && (
            <p className={evidenceStyles.error} role="alert">
              {error}
            </p>
          )}
          <div className={styles.actions}>
            <button
              type="button"
              className={shared.textButton}
              disabled={busy !== null || result?.ok}
              onClick={() => request(false)}
            >
              {busy === "preview" ? "Updating…" : "Update preview"}
            </button>
            <button
              type="button"
              className={shared.primarySmall}
              disabled={
                busy !== null ||
                !previewReady ||
                !preview ||
                stale ||
                result?.ok
              }
              onClick={() => request(true)}
            >
              {busy === "send"
                ? "Sending…"
                : result?.ok
                  ? "Sent"
                  : `Send to ${preview?.to || name}`}
              <span className={shared.primarySmallArrow} aria-hidden="true">
                →
              </span>
            </button>
          </div>
        </footer>
      </dialog>
    </>
  );
}
