import styles from "./LoginForm.module.css";

export default function LoginForm({ error }) {
  return (
    <>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <form className={styles.form} action="/api/demo-login" method="post">
        <label htmlFor="email">Email address</label>
        <div className={styles.inputRow}>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            maxLength={254}
            placeholder="you@example.com"
            required
          />
          <button type="submit">
            Sign in <span aria-hidden="true">→</span>
          </button>
        </div>
        <p className={styles.hint}>
          Demo sign in uses email only. No password needed.
        </p>
      </form>
    </>
  );
}
