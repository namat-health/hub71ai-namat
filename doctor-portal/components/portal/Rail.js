import Logo from "./Logo";
import styles from "./Rail.module.css";

const TITLES = /^(dr|prof|mr|mrs|ms|mx)\.?$/i;

// "Dr. Amira Khan" → "AK": titles are not initials.
function initials(name) {
  const parts = name.split(/\s+/).filter((part) => part && !TITLES.test(part));
  const letters =
    parts.length > 1 ? parts[0][0] + parts.at(-1)[0] : parts[0]?.[0] || "N";
  return letters.toUpperCase();
}

function Group({ id, label, people, open, activeKey, onToggle, onSelect }) {
  return (
    <div className={styles.group}>
      <button
        type="button"
        className={styles.groupButton}
        aria-expanded={open}
        aria-controls={`rail-${id}`}
        onClick={onToggle}
      >
        <span>{label}</span>
        <span className={styles.groupMeta}>
          {people.length}
          <span
            className={`${styles.chevron} ${open ? styles.chevronOpen : ""}`}
            aria-hidden="true"
          >
            ⌄
          </span>
        </span>
      </button>
      {open && (
        <div className={styles.people} id={`rail-${id}`}>
          {people.map((person) => (
            <button
              type="button"
              key={person.key}
              className={`${styles.person} ${person.key === activeKey ? styles.active : ""}`}
              aria-current={person.key === activeKey ? "page" : undefined}
              onClick={() => onSelect(person.key)}
            >
              <span className={styles.personName}>
                {person.name}
                {person.isNew && (
                  <span className={styles.hidden}>, awaiting review</span>
                )}
              </span>
              <span
                className={`${styles.dot} ${person.isNew ? styles.dotNew : ""}`}
                aria-hidden="true"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Rail({
  queue,
  reviewed,
  status,
  activeKey,
  open,
  clinician,
  onToggle,
  onSelect,
  onRetry,
}) {
  const doctor = clinician || "Doctor";
  return (
    <aside className={styles.rail} aria-label="Patients">
      <Logo size={30} color="#fbfaf4" className={styles.logo} />
      <nav className={styles.nav}>
        {status === "loading" && <p className={styles.message}>Loading…</p>}
        {status === "error" && (
          <>
            <p className={styles.message} role="alert">
              Couldn’t load patients.
            </p>
            <button type="button" className={styles.retry} onClick={onRetry}>
              Try again
            </button>
          </>
        )}
        {status === "ready" && (
          <>
            <Group
              id="queue"
              label="Review queue"
              people={queue.map((person) => ({ ...person, isNew: true }))}
              open={open.queue}
              activeKey={activeKey}
              onToggle={() => onToggle("queue")}
              onSelect={onSelect}
            />
            <Group
              id="all"
              label="All patients"
              people={reviewed}
              open={open.all}
              activeKey={activeKey}
              onToggle={() => onToggle("all")}
              onSelect={onSelect}
            />
          </>
        )}
      </nav>
      <div className={styles.doctor}>
        <span className={styles.initials} aria-hidden="true">
          {initials(doctor)}
        </span>
        <span className={styles.doctorName}>{doctor}</span>
      </div>
    </aside>
  );
}

export function MobileBar({ patients, activeKey, onSelect }) {
  return (
    <div className={styles.mobileBar}>
      <Logo size={24} color="#fbfaf4" />
      {patients.length > 0 && (
        <select
          className={styles.mobileSelect}
          aria-label="Patient"
          value={activeKey || ""}
          onChange={(event) => onSelect(event.target.value)}
        >
          {patients.map((patient) => (
            <option key={patient.key} value={patient.key}>
              {patient.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
