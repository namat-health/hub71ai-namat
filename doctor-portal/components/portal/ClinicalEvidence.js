import { evidenceLink } from "@/lib/clinical/evidence-links.mjs";
import styles from "./ClinicalEvidence.module.css";

const label = (value) =>
  String(value || "")
    .replaceAll("_", " ")
    .replaceAll("-", " ");
const textFor = (item) =>
  typeof item === "string"
    ? item
    : item.reason || item.text || item.message || label(item.code);
const sourceUrl = (url) => {
  try {
    return new URL(url).protocol === "https:" ? url : null;
  } catch {
    return null;
  }
};

export function ReviewAlerts({ analysis }) {
  const alerts = analysis?.reviewAlerts || [];
  if (!alerts.length) return null;
  return (
    <div className={styles.alert} aria-live="polite">
      <strong>Clinician review required</strong>
      <ul>
        {alerts.map((item, index) => (
          <li key={`${item.reference || item.code}:${index}`}>
            {textFor(item)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function EvidenceLinks({ analysis, references, title, onEvidence }) {
  if (!references?.length) return null;
  return (
    <div className={styles.referenceGroup}>
      <strong>{title}</strong>
      <ul>
        {references.map((id) => {
          const link = evidenceLink(analysis, id);
          return (
            <li key={id}>
              <button
                type="button"
                disabled={!link || !onEvidence}
                onClick={() => onEvidence(link.id)}
              >
                {link?.label || "Source reference unavailable"}
              </button>
              {link?.quote && <blockquote>{link.quote}</blockquote>}
              {link?.verification && (
                <small>
                  {link.verification === "text_match"
                    ? "Quote matches extracted report text"
                    : "Read from the original image · confirm the quote on this page"}
                </small>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function FindingBasis({ analysis, index, onEvidence }) {
  const finding = analysis?.grounding?.findings?.find(
    (item) => item.index === index,
  );
  if (!finding) return null;
  const claims = (analysis.evidence?.claims || []).filter((claim) =>
    finding.claimIds?.includes(claim.id),
  );
  const sources = (analysis.evidence?.sources || []).filter(
    (source) =>
      claims.some((claim) => claim.sourceIds?.includes(source.id)) &&
      sourceUrl(source.url),
  );
  return (
    <div className={styles.basis}>
      <span className={styles.kind}>
        {finding.kind === "possible_explanation"
          ? "Possible explanation · requires clinical judgement"
          : "Observed finding"}
      </span>
      <EvidenceLinks
        analysis={analysis}
        references={finding.evidenceIds}
        title="Supporting evidence"
        onEvidence={onEvidence}
      />
      <EvidenceLinks
        analysis={analysis}
        references={finding.contraryEvidenceIds}
        title="Evidence against this explanation"
        onEvidence={onEvidence}
      />
      {finding.uncertainties?.length > 0 && (
        <ul className={styles.unknowns}>
          {finding.uncertainties.map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ul>
      )}
      {claims.length > 0 && (
        <details className={styles.details}>
          <summary>Clinical reference and sources</summary>
          {claims.map((claim) => (
            <p key={claim.id}>{claim.text}</p>
          ))}
          <div className={styles.sourceLinks}>
            {sources.map((source) => (
              <a
                key={source.id}
                href={source.url}
                target="_blank"
                rel="noreferrer"
              >
                {new URL(source.url).hostname} ↗
              </a>
            ))}
          </div>
          <small>
            Knowledge records remain draft; a linked source is reference
            support, not a diagnosis.
          </small>
        </details>
      )}
    </div>
  );
}

export default function ClinicalEvidence({
  analysis,
  compact = false,
  onEvidence,
}) {
  if (!analysis) return null;
  const questions = analysis.grounding?.questionsForDoctor || [];
  const observations = new Map(
    (analysis.evidence?.observations || []).map((item) => [item.id, item]),
  );
  const actions = analysis.actionLedger || [];
  return (
    <div className={styles.evidence}>
      {questions.length > 0 && (
        <section>
          <h3>Questions that could change the next step</h3>
          <ul>
            {questions.map((item, index) => (
              <li key={item.id || `${textFor(item)}:${index}`}>
                {textFor(item)}
              </li>
            ))}
          </ul>
        </section>
      )}
      <details className={styles.details} open={!compact}>
        <summary>
          Coverage and limitations
          {analysis.reportCoverage?.length > 0
            ? ` · ${analysis.reportCoverage.length} report pages`
            : ` · ${analysis.coverage?.length || 0} parsed results`}
        </summary>
        {(analysis.limitations || []).length > 0 && (
          <ul>
            {analysis.limitations.map((item, index) => (
              <li key={`${item.code || item.reference}:${index}`}>
                {textFor(item)}
              </li>
            ))}
          </ul>
        )}
        {(analysis.reportCoverage || []).map((item) => {
          const link = evidenceLink(analysis, {
            type: "report",
            reportId: item.reportId,
            page: item.page,
          });
          return (
            <div
              key={`${item.reportId}:${item.page}`}
              className={styles.coverageRow}
            >
              <button
                type="button"
                disabled={!link || !onEvidence}
                onClick={() => onEvidence(link.id)}
              >
                {link?.label || `Report page ${item.page}`}
              </button>
              <span>{label(item.status)}</span>
              <p>{item.reason}</p>
            </div>
          );
        })}
        {(analysis.coverage || []).map((item) => {
          const observation = observations.get(item.observationId);
          return (
            <div key={item.observationId} className={styles.coverageRow}>
              <button
                type="button"
                disabled={!observation || !onEvidence}
                onClick={() => onEvidence(item.observationId)}
              >
                {observation?.name || "Report result"}
              </button>
              <span>
                {label(
                  item.modelDisposition?.disposition ||
                    item.modelDisposition ||
                    item.status,
                )}
              </span>
              <p>{item.modelDisposition?.reason || item.reason}</p>
            </div>
          );
        })}
      </details>
      {actions.length > 0 && (
        <details className={styles.details} open={!compact}>
          <summary>
            Proposed tests and review requirements · {actions.length}
          </summary>
          {actions.map((item) => (
            <div
              key={item.id || item.candidateId || item.testId}
              className={styles.ledgerRow}
            >
              <strong>
                {label(
                  (item.knowledgeId || item.testId || item.id || "Review")
                    .split(":")
                    .at(-1),
                )}
              </strong>
              <span>
                {item.policyStatus === "eligible"
                  ? "Eligible for clinician review"
                  : ["conditional", "needs_context"].includes(item.policyStatus)
                    ? "Needs clarification before selection"
                    : item.policyStatus === "blocked"
                      ? "Not available for selection"
                      : label(item.decision)}
              </span>
              <p>{item.rationale || item.reason}</p>
              {item.policyReasons?.length > 0 && (
                <ul className={styles.policyReasons}>
                  {item.policyReasons.map((reason, index) => (
                    <li key={`${textFor(reason)}:${index}`}>
                      {textFor(reason)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </details>
      )}
      {!compact && (
        <p className={styles.meta}>
          {analysis.cached ? "Saved assessment" : "Assessment"}
          {analysis.evaluatedAt
            ? ` · ${new Date(analysis.evaluatedAt).toLocaleString()}`
            : ""}
          . Input and knowledge versions are retained with this review.
        </p>
      )}
    </div>
  );
}
