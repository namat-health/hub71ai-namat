"use client";

import { useState } from "react";
import { evidenceLink } from "@/lib/clinical/evidence-links.mjs";
import { QUESTIONNAIRE_GROUPS } from "@/lib/questionnaire.mjs";
import styles from "./OfflineAnalysisPreview.module.css";
import PlanCard from "./PlanCard";
import PlanModal from "./PlanModal";

const questionLabels = Object.fromEntries(
  QUESTIONNAIRE_GROUPS.flatMap((group) =>
    group.rows.map((row) => [row.key, row.label]),
  ),
);

export default function OfflineAnalysisPreview({
  analysis,
  generated = false,
}) {
  const [selected, setSelected] = useState([]),
    [expanded, setExpanded] = useState(new Set()),
    [modal, setModal] = useState(null),
    [focus, setFocus] = useState(null);
  const toggleTest = (id) =>
    setSelected((items) =>
      items.includes(id) ? items.filter((item) => item !== id) : [...items, id],
    );
  const evidence = (reference) => {
    const link = evidenceLink(analysis, reference);
    setFocus(
      link?.type === "questionnaire" ? "questionnaire" : link?.id || reference,
    );
    setModal(null);
  };
  const chipsFor = (finding) =>
    finding.evidence.map((item) => {
      const observation = analysis.evidence.observations.find(
        (row) => row.uiLabId === item.labId,
      );
      return {
        key: item.labId || item.key || `${item.reportId}:${item.page}`,
        text: observation
          ? `${observation.name} ${observation.current.value} ${observation.current.unit}`
          : item.label,
        where:
          item.type === "report"
            ? `· fictional report page ${item.page}`
            : observation
              ? "· fictional report"
              : "· fictional intake",
        onClick: () => evidence(observation?.id || item),
      };
    });
  return (
    <main className={styles.page}>
      <header>
        <strong>Namat · Clinical review</strong>
        <p>
          {generated
            ? "Saved OpenAI analysis · Fictional case · Doctor review required"
            : "Offline interface preview — fictional fixture, not AI-generated"}
        </p>
      </header>
      <div className={styles.columns}>
        <section
          className={styles.report}
          aria-label="Fictional source evidence"
        >
          <span className={styles.eyebrow}>
            Source evidence · Fictional report
          </span>
          <h1>Example patient</h1>
          <p>Adult, 42 · Report collected 20 September 2026</p>
          <table>
            <thead>
              <tr>
                <th>Marker</th>
                <th>Result</th>
                <th>Printed range</th>
              </tr>
            </thead>
            <tbody>
              {analysis.evidence.observations.map((row) => (
                <tr
                  key={row.id}
                  className={focus === row.id ? styles.focus : ""}
                >
                  <th>{row.name}</th>
                  <td>
                    {row.current.value} {row.current.unit}
                  </td>
                  <td>{row.current.referenceRange}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className={focus === "questionnaire" ? styles.focus : ""}>
            <h2>Questionnaire context</h2>
            {generated ? (
              <ul>
                {analysis.evidence.facts
                  .filter(
                    (fact) =>
                      fact.kind === "answer" && fact.status === "reported",
                  )
                  .map((fact) => (
                    <li key={fact.id}>
                      {questionLabels[fact.key] || fact.key}: {fact.text}
                    </li>
                  ))}
              </ul>
            ) : (
              <p>
                Reported fatigue. Bleeding history, recent iron use and
                draw-time fasting status are not recorded.
              </p>
            )}
          </div>
          <p className={styles.note}>
            Click a report chip in the assessment to highlight its source. Test
            selections start empty. Saving a clinical decision is disabled in
            this offline preview.
          </p>
        </section>
        <div className={styles.assessment}>
          <PlanCard
            state={{ status: "ready", plan: analysis.plan, analysis, selected }}
            expanded={expanded}
            onToggleFinding={(index) =>
              setExpanded((items) => {
                const next = new Set(items);
                if (next.has(index)) next.delete(index);
                else next.add(index);
                return next;
              })
            }
            chipsFor={chipsFor}
            toConfirm={[]}
            onToggleTest={toggleTest}
            onReadPlan={() => setModal("plan")}
            onApprove={() => setModal("review")}
            onEvidence={evidence}
          />
        </div>
      </div>
      <PlanModal
        mode={modal}
        plan={analysis.plan}
        selected={selected}
        onToggleTest={toggleTest}
        chipsFor={chipsFor}
        patientName="Example patient · Fictional"
        onMode={setModal}
        analysis={analysis}
        onEvidence={evidence}
      />
    </main>
  );
}
