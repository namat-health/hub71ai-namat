import styles from "./Logo.module.css";

const HEALTH = [
  ["h1", "h"],
  ["e", "e"],
  ["a", "a"],
  ["l", "l"],
  ["t", "t"],
  ["h2", "h"],
];

export default function Logo({ size, color, className = "" }) {
  return (
    <span
      className={`${styles.logo} ${className}`}
      style={{ fontSize: size, color }}
      role="img"
      aria-label="Namat Health"
    >
      <span className={styles.word} aria-hidden="true">
        namat
      </span>
      <span className={styles.rule} aria-hidden="true" />
      <span className={styles.stop} aria-hidden="true" />
      <span className={styles.health} aria-hidden="true">
        {HEALTH.map(([key, letter]) => (
          <span key={key}>{letter}</span>
        ))}
      </span>
    </span>
  );
}
