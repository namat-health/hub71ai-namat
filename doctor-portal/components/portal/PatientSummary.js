import styles from "./PatientSummary.module.css";

export default function PatientSummary({
  name,
  profile,
  context,
  onQuestionnaire,
}) {
  return (
    <section className={styles.summary} aria-label="Patient">
      <h1 className={styles.name}>{name}</h1>
      <div className={styles.meta}>
        <span className={styles.profile}>{profile}</span>
        <button type="button" className={styles.link} onClick={onQuestionnaire}>
          Questionnaire <span aria-hidden="true">→</span>
        </button>
      </div>
      {context && <p className={styles.context}>{context}</p>}
    </section>
  );
}
